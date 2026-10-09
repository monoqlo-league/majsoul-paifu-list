// 雀魂の牌譜(protobuf)を、schema.js の定義だけを頼りに読む最小限のデコーダ。
// 拡張機能では eval が使えないため、定義から関数を生成する一般のライブラリは使わない。
// 定義に無いフィールドは読み飛ばすので、雀魂側でフィールドが増えても壊れない。
(function (root) {
  const MPS = (root.MPS = root.MPS || {});
  const utf8 = new TextDecoder("utf-8");

  function Reader(bytes) {
    this.b = bytes;
    this.p = 0;
  }

  // varint を Number で返す。負の int32 は10バイトで来るため、32bitを超える分は捨てずに読み切る。
  Reader.prototype.varint = function () {
    let low = 0;
    let high = 0;
    let shift = 0;
    for (;;) {
      if (this.p >= this.b.length) throw new Error("牌譜データが途中で切れています");
      const byte = this.b[this.p++];
      if (shift < 28) low |= (byte & 0x7f) << shift;
      else if (shift === 28) {
        low |= (byte & 0x0f) << 28;
        high |= (byte & 0x70) >> 4;
      } else high |= (byte & 0x7f) << (shift - 32);
      if (!(byte & 0x80)) break;
      shift += 7;
      if (shift > 63) throw new Error("牌譜データの数値が不正です");
    }
    return { low: low >>> 0, high: high >>> 0 };
  };

  Reader.prototype.bytes = function () {
    const length = this.varint().low;
    if (this.p + length > this.b.length) throw new Error("牌譜データが途中で切れています");
    const view = this.b.subarray(this.p, this.p + length);
    this.p += length;
    return view;
  };

  Reader.prototype.skip = function (wireType) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.p += 8;
    else if (wireType === 2) this.bytes();
    else if (wireType === 5) this.p += 4;
    else throw new Error("牌譜データの形式が想定と違います (wire type " + wireType + ")");
  };

  function scalarFromVarint(type, value) {
    if (type === "bool") return value.low !== 0 || value.high !== 0;
    if (type === "int32") return value.low | 0;
    if (type === "uint32") return value.low;
    // 64bit は牌譜の集計では使わないが、桁落ちしない範囲で数値にしておく。
    return value.high * 4294967296 + value.low;
  }

  function defaultValue(type, repeated) {
    if (repeated) return [];
    if (type === "string") return "";
    if (type === "bytes") return new Uint8Array(0);
    if (type === "bool") return false;
    if (MPS.schema[type]) return null;
    return 0;
  }

  // typeName の定義に従って bytes を読み、プレーンなオブジェクトにする。
  function decode(typeName, bytes) {
    const fields = MPS.schema[typeName];
    if (!fields) throw new Error("未知の牌譜データ型です: " + typeName);
    const out = {};
    for (const id in fields) out[fields[id][0]] = defaultValue(fields[id][1], fields[id][2]);

    const reader = new Reader(bytes);
    while (reader.p < bytes.length) {
      const tag = reader.varint().low;
      const wireType = tag & 7;
      const field = fields[tag >>> 3];
      if (!field) {
        reader.skip(wireType);
        continue;
      }
      const name = field[0];
      const type = field[1];
      const repeated = field[2];
      let value;
      if (wireType === 2) {
        const chunk = reader.bytes();
        if (type === "string") value = utf8.decode(chunk);
        else if (type === "bytes") value = chunk;
        else if (MPS.schema[type]) value = decode(type, chunk);
        else {
          // 数値の繰り返しは、まとめて1つのかたまり(packed)で入っている。
          const packed = new Reader(chunk);
          while (packed.p < chunk.length) out[name].push(scalarFromVarint(type, packed.varint()));
          continue;
        }
      } else if (wireType === 0) {
        value = scalarFromVarint(type, reader.varint());
      } else {
        reader.skip(wireType);
        continue;
      }
      if (repeated) out[name].push(value);
      else out[name] = value;
    }
    return out;
  }

  // Wrapper{name, data} を開く。name は ".lq.RecordHule" のような完全修飾名。
  function unwrap(bytes) {
    const wrapper = decode("Wrapper", bytes);
    return { name: wrapper.name.replace(/^\.?lq\./, ""), data: wrapper.data };
  }

  // 牌譜の本体(GameDetailRecords を包んだ Wrapper)を、局イベントの配列にする。
  function decodeDetail(bytes) {
    const detail = decode("GameDetailRecords", unwrap(bytes).data);
    // 新しい牌譜は actions[].result に、古い牌譜は records[] に局イベントが入る。
    const wrapped = detail.records.length
      ? detail.records
      : detail.actions.map((action) => action.result).filter((result) => result && result.length);
    const actions = [];
    for (const record of wrapped) {
      const inner = unwrap(record);
      // 集計に使わない種類のイベントは定義を持たないので、名前だけ残して中身は読まない。
      actions.push({ name: inner.name, data: MPS.schema[inner.name] ? decode(inner.name, inner.data) : null });
    }
    return actions;
  }

  // fetchGameRecord の応答フレーム(WebSocketで受信した生バイト)を読む。
  // 先頭3バイトは [種別:1][通し番号:2]。その後ろが Wrapper{name:"", data:ResGameRecord}。
  function decodeResponse(raw) {
    const response = decode("ResGameRecord", unwrap(raw.subarray(3)).data);
    if (response.error && response.error.code) {
      const error = new Error("雀魂がエラーを返しました (code " + response.error.code + ")");
      error.serverCode = response.error.code;
      throw error;
    }
    if (!response.head) throw new Error("牌譜の応答ではありません");
    return response;
  }

  MPS.pb = { decode, unwrap, decodeDetail, decodeResponse };
})(typeof globalThis !== "undefined" ? globalThis : this);
