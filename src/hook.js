// 雀魂のページ本体と同じ世界(MAIN world)で動く。役割は2つ。
//   1. 雀魂自身の通信を横から読み、要求を送るのに必要なもの(接続・通し番号・バージョン文字列)を覚える。
//      通信内容は変えない。雀魂で牌譜を開いても、その牌譜は取り込まない(リスト取得版の決まり)。
//   2. content.js から頼まれたとき、雀魂が開いている接続に「牌譜をください」という要求を1件送り、
//      その応答だけを content.js に渡す。要求の形は雀魂自身が送るものと同じ。
//      送る頻度は content.js が決める(1件ごとに待機時間をあける)。
//
// 雀魂の通信フレームは [種別:1バイト][通し番号:2バイト][本体]。
// こちらが送った要求(fetchGameRecord)の通し番号を覚えておき、同じ番号の応答が届いたら、それを牌譜として取り出す。
// この対応付けの方法は MahjongSoul-review-supporter (Apache-2.0) を参考にした。
(function () {
  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || NativeWebSocket.prototype.__mpslHooked) return;
  NativeWebSocket.prototype.__mpslHooked = true;

  const FRAME_REQUEST = 2;
  const FRAME_RESPONSE = 3;
  const MAX_REQUEST_BYTES = 16384;
  const LOBBY_PREFIX = ".lq.Lobby.";
  const FETCH_NAME = ".lq.Lobby.fetchGameRecord";
  // 雀魂のクライアントが名乗るバージョン文字列が入っているフィールド番号(要求の種類ごと)。
  // 牌譜の要求にも同じ文字列を入れる必要があるので、雀魂自身の要求から読み取っておく。
  const VERSION_FIELD = {
    ".lq.Lobby.fetchGameRecord": 2,
    ".lq.Lobby.oauth2Login": 10,
    ".lq.Lobby.login": 11,
  };
  const UUID_PATTERN = /^\d{6}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // 雀魂が使っている通し番号から十分離れた番号を使い、雀魂自身の要求と取り違えないようにする。
  const INDEX_OFFSET = 30000;
  const INDEX_MODULUS = 60000;

  const ascii = (text) => Array.from(text, (char) => char.charCodeAt(0));
  const text = new TextDecoder("utf-8");

  const stateBySocket = new WeakMap(); // socket -> { pending: Map<通し番号, token>, lastIndex }
  let lobbySocket = null; // 雀魂がロビーとの通信に使っている接続
  let versionBytes = null; // バージョン文字列(生バイト)
  let recordRequestTemplate = null; // 雀魂自身が送った牌譜要求の中身。あればこれを雛形にする
  let injectedCount = 0;

  // ---- protobuf の最小限の読み書き ----

  function readVarint(bytes, position) {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (position >= bytes.length) throw new Error("truncated");
      const byte = bytes[position++];
      if (shift < 28) value |= (byte & 0x7f) << shift;
      shift += 7;
      if (!(byte & 0x80)) return [value >>> 0, position];
    }
  }

  function writeVarint(out, value) {
    while (value > 0x7f) {
      out.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    out.push(value);
  }

  // メッセージを最上位のフィールドに切り分ける。raw はタグを含むそのままのバイト列。
  function splitFields(bytes) {
    const fields = [];
    let position = 0;
    while (position < bytes.length) {
      const start = position;
      let tag;
      [tag, position] = readVarint(bytes, position);
      const wireType = tag & 7;
      let valueStart = position;
      if (wireType === 0) [, position] = readVarint(bytes, position);
      else if (wireType === 1) position += 8;
      else if (wireType === 5) position += 4;
      else if (wireType === 2) {
        let length;
        [length, position] = readVarint(bytes, position);
        valueStart = position;
        position += length;
      } else throw new Error("unsupported wire type");
      if (position > bytes.length) throw new Error("truncated");
      fields.push({ id: tag >>> 3, wireType, raw: bytes.subarray(start, position), value: bytes.subarray(valueStart, position) });
    }
    return fields;
  }

  function lengthDelimited(id, valueBytes) {
    const out = [];
    writeVarint(out, (id << 3) | 2);
    writeVarint(out, valueBytes.length);
    for (const byte of valueBytes) out.push(byte);
    return out;
  }

  // 要求フレームを { 名前, 中身 } に分ける。要求でなければ null。
  function parseRequest(bytes) {
    if (bytes.length < 5 || bytes.length > MAX_REQUEST_BYTES || bytes[0] !== FRAME_REQUEST) return null;
    try {
      const fields = splitFields(bytes.subarray(3));
      const name = fields.find((field) => field.id === 1 && field.wireType === 2);
      const data = fields.find((field) => field.id === 2 && field.wireType === 2);
      if (!name) return null;
      return { name: text.decode(name.value), data: data ? data.value : new Uint8Array(0) };
    } catch (error) {
      return null;
    }
  }

  function frameIndex(bytes) {
    return bytes[1] | (bytes[2] << 8);
  }

  function asBytes(data, use) {
    if (data instanceof ArrayBuffer) use(new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) use(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    else if (typeof Blob !== "undefined" && data instanceof Blob) data.arrayBuffer().then((buffer) => use(new Uint8Array(buffer)));
  }

  // ---- 雀魂自身の通信を読む ----

  function onSend(socket, bytes) {
    const request = parseRequest(bytes);
    if (!request || !request.name.startsWith(LOBBY_PREFIX)) return;
    const state = stateBySocket.get(socket);
    lobbySocket = socket;
    state.lastIndex = frameIndex(bytes);

    const versionField = VERSION_FIELD[request.name];
    if (versionField) {
      try {
        const fields = splitFields(request.data);
        const version = fields.find((field) => field.id === versionField && field.wireType === 2);
        if (version && version.value.length) versionBytes = version.value.slice();
        if (request.name === FETCH_NAME) recordRequestTemplate = request.data.slice();
      } catch (error) {
        // 読めなくても雀魂の通信には影響しない。
      }
    }
    // 雀魂自身が送った牌譜の要求は、雛形として覚えるだけ。その応答は取り込まない。
  }

  // こちらが送った要求への応答なら content.js に渡して true を返す。それ以外は触らない。
  function onReceive(socket, bytes) {
    if (bytes.length < 3 || bytes[0] !== FRAME_RESPONSE) return false;
    const state = stateBySocket.get(socket);
    const index = frameIndex(bytes);
    if (!state.pending.has(index)) return false;
    const token = state.pending.get(index);
    state.pending.delete(index);
    // ページ側のバッファを巻き込まないよう複製してから渡す。
    const copy = bytes.slice().buffer;
    window.postMessage({ __mpsl: "record", bytes: copy, token }, window.location.origin);
    return true;
  }

  const nativeSend = NativeWebSocket.prototype.send;
  const nativeAddEventListener = NativeWebSocket.prototype.addEventListener;

  function attach(socket) {
    if (stateBySocket.has(socket)) return;
    stateBySocket.set(socket, { pending: new Map(), lastIndex: 0 });
    nativeAddEventListener.call(socket, "message", function (event) {
      try {
        if (event.data instanceof ArrayBuffer) {
          // こちらが送った要求への応答は、雀魂には渡さない(雀魂は自分が送っていない番号の応答を知らないため)。
          if (onReceive(socket, new Uint8Array(event.data))) event.stopImmediatePropagation();
        } else {
          asBytes(event.data, (bytes) => onReceive(socket, bytes));
        }
      } catch (error) {
        console.warn("[牌譜スタッツ出力 リスト取得版] 受信の読み取りに失敗", error);
      }
    });
  }

  // 接続が作られた瞬間に受信の監視を付ける。雀魂より先に付けておかないと、
  // こちらが送った要求への応答を雀魂に渡さないようにすることができない。
  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      try {
        attach(socket);
      } catch (error) {
        console.warn("[牌譜スタッツ出力 リスト取得版] 接続の監視を付けられませんでした", error);
      }
      return socket;
    },
  });

  NativeWebSocket.prototype.send = function (data) {
    try {
      attach(this);
      asBytes(data, (bytes) => onSend(this, bytes));
    } catch (error) {
      // ここで失敗しても雀魂の通信は必ず通す。
      console.warn("[牌譜スタッツ出力 リスト取得版] 送信の読み取りに失敗", error);
    }
    return nativeSend.apply(this, arguments);
  };

  // ---- content.js に頼まれた牌譜の要求を送る ----

  function buildRecordRequest(uuid) {
    const uuidField = lengthDelimited(1, ascii(uuid));
    let data = [];
    if (recordRequestTemplate) {
      // 雀魂自身の要求を雛形にし、ゲームIDだけ差し替える。
      for (const field of splitFields(recordRequestTemplate)) {
        const chunk = field.id === 1 ? uuidField : field.raw;
        for (const byte of chunk) data.push(byte);
      }
    } else {
      data = uuidField.concat(lengthDelimited(2, versionBytes));
    }
    return lengthDelimited(1, ascii(FETCH_NAME)).concat(lengthDelimited(2, data));
  }

  function failed(token, reason) {
    window.postMessage({ __mpsl: "fetch-failed", token, reason }, window.location.origin);
  }

  function requestRecord(uuid, token) {
    if (!UUID_PATTERN.test(uuid)) return failed(token, "bad-uuid");
    if (!lobbySocket || lobbySocket.readyState !== NativeWebSocket.OPEN) return failed(token, "no-socket");
    if (!recordRequestTemplate && !versionBytes) return failed(token, "no-version");

    const state = stateBySocket.get(lobbySocket);
    let index = (state.lastIndex + INDEX_OFFSET + injectedCount++) % INDEX_MODULUS;
    while (state.pending.has(index)) index = (index + 1) % INDEX_MODULUS;

    const frame = Uint8Array.from([FRAME_REQUEST, index & 0xff, index >> 8].concat(buildRecordRequest(uuid)));
    state.pending.set(index, token);
    try {
      nativeSend.call(lobbySocket, frame);
    } catch (error) {
      state.pending.delete(index);
      failed(token, "send-error");
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.__mpsl !== "fetch" || typeof data.uuid !== "string" || typeof data.token !== "string") return;
    try {
      requestRecord(data.uuid, data.token);
    } catch (error) {
      console.warn("[牌譜スタッツ出力 リスト取得版] 牌譜の要求を送れませんでした", error);
      failed(data.token, "send-error");
    }
  });
})();
