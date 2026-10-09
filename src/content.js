// 対局一覧のCSVに載っている牌譜を、1件ずつ間隔をあけて取得する(リスト取得版)。
// hook.js に牌譜の要求を頼み、返ってきた牌譜を読み解いて集計し、拡張機能の保存領域に入れる。
// ポップアップは保存領域だけを読むので、雀魂のタブを閉じても取得した対局は残る。
// 雀魂で牌譜を開いても取り込まない。取り込むのは、ここから頼んだ要求への応答だけ。
//
// ポップアップは閉じると消えるので、順番待ちの管理は雀魂のタブ側(このスクリプト)が持ち、
// 進み具合を保存領域に書く。
(function () {
  const MPS = globalThis.MPS;
  const STORED_VERSION = 3; // 2: 最大連荘数を旧定義(maxRenchan)で持つ / 3: 新定義(maxDealerRun)で持つ
  const GAME_PREFIX = "game:";

  // 一括取得で、牌譜の要求と要求の間にあける時間(秒)。ポップアップの入力欄で変えられる。
  // 下限は、入力の誤りで雀魂に続けざまに要求を送ってしまわないためのもの。
  const DEFAULT_INTERVAL_SEC = 20;
  const MIN_INTERVAL_SEC = 5;
  const MAX_INTERVAL_SEC = 600;
  const RESPONSE_TIMEOUT_MS = 20000;
  // 牌譜の中身を読めない失敗が続けてこの回数起きたら、同じ失敗を繰り返さないよう全体を止める。
  // (雀魂がエラーを返したときと、応答が無いときは、回数に関係なく1回で止める)
  const MAX_CONSECUTIVE_FAILURES = 3;
  const UUID_PATTERN = /^\d{6}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const FAILURE_TEXT = {
    "bad-uuid": "ゲームIDの形式が違います",
    "no-socket": "雀魂との接続が見つかりません。雀魂のタブを再読み込みし、ログインしてからやり直してください",
    "no-version": "雀魂のバージョンを読み取れていません。雀魂のタブを再読み込みするか、牌譜を1件だけ手で開いてからやり直してください",
    "send-error": "雀魂に要求を送れませんでした",
  };
  // 要求を送る前に分かる失敗。続けても同じ結果になるので、その場で全体を止める。
  const FATAL_REASONS = new Set(["no-socket", "no-version", "send-error"]);

  function saveStatus(status) {
    status.time = Date.now();
    return chrome.storage.local.set({ status });
  }

  // 応答フレームを読み解いて保存する。結果を { ok, uuid, message, serverError } で返す。
  // serverError は、雀魂がエラーを返したとき(取得制限など)に true。
  async function handle(bytes) {
    let uuid = "";
    try {
      const response = MPS.pb.decodeResponse(bytes);
      uuid = response.head.uuid;
      if (!response.data.length) {
        throw new Error(
          response.data_url ? "この牌譜は古い保存形式のため未対応です" : "牌譜の本体が空でした",
        );
      }
      const game = MPS.analyze.analyzeGame(response.head, MPS.pb.decodeDetail(response.data));
      game.v = STORED_VERSION;
      game.capturedAt = Date.now();
      await chrome.storage.local.set({ [GAME_PREFIX + uuid]: game });
      await saveStatus({ ok: true, uuid });
      return { ok: true, uuid, message: "", serverError: false };
    } catch (error) {
      console.warn("[牌譜スタッツ出力 リスト取得版] 牌譜を取り込めませんでした", error);
      const message = String((error && error.message) || error);
      try {
        await saveStatus({ ok: false, uuid, message });
      } catch (storageError) {
        console.warn("[牌譜スタッツ出力 リスト取得版] 状態を保存できませんでした", storageError);
      }
      return { ok: false, uuid, message, serverError: Boolean(error && error.serverCode) };
    }
  }

  // ---- 一括取得 ----

  const waiting = new Map(); // token -> 結果を受け取る関数
  let running = false;
  let stopRequested = false;

  function fetchOne(uuid) {
    return new Promise((resolve) => {
      const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => {
        waiting.delete(token);
        resolve({ ok: false, message: "雀魂から応答がありませんでした", fatal: false, halt: true });
      }, RESPONSE_TIMEOUT_MS);
      waiting.set(token, (result) => {
        clearTimeout(timer);
        waiting.delete(token);
        resolve(result);
      });
      window.postMessage({ __mpsl: "fetch", uuid, token }, window.location.origin);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 入力された待機時間を、使える範囲の秒数に直す。
  function intervalSeconds(value) {
    const seconds = Math.round(Number(value));
    if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_INTERVAL_SEC;
    return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, seconds));
  }

  async function runQueue(uuids, intervalMs) {
    running = true;
    stopRequested = false;
    const queue = {
      state: "running",
      reason: "",
      nextAt: 0,
      intervalMs,
      items: uuids.map((uuid) => ({ uuid, status: "pending", message: "" })),
    };
    const save = () => chrome.storage.local.set({ queue });

    try {
      // 止めてすぐ始め直しても間隔が守られるよう、最後に要求を送った時刻は保存領域から読む。
      let { lastFetchAt = 0 } = await chrome.storage.local.get("lastFetchAt");
      // 以前に出力した集計のCSVに載っている対局。ポップアップで読み込んだもの。
      const { exported } = await chrome.storage.local.get("exported");
      const exportedIds = new Set(exported ? exported.uuids : []);
      let failures = 0;
      await save();

      for (const item of queue.items) {
        if (stopRequested) break;

        // 出力済みの対局と取り込み済みの対局は、雀魂に要求しない。
        if (exportedIds.has(item.uuid)) {
          item.status = "exported";
          await save();
          continue;
        }
        const key = GAME_PREFIX + item.uuid;
        if ((await chrome.storage.local.get(key))[key]) {
          item.status = "skip";
          await save();
          continue;
        }

        const nextAt = lastFetchAt + intervalMs;
        if (Date.now() < nextAt) {
          queue.nextAt = nextAt;
          await save();
          while (Date.now() < nextAt && !stopRequested) await sleep(Math.min(500, nextAt - Date.now()));
          if (stopRequested) break;
        }

        queue.nextAt = 0;
        item.status = "fetching";
        lastFetchAt = Date.now();
        await chrome.storage.local.set({ queue, lastFetchAt });

        const result = await fetchOne(item.uuid);
        if (result.ok) {
          item.status = "ok";
          failures = 0;
        } else if (result.fatal) {
          // 要求を送れていないので、この1件は未取得のまま残す(再開できるように)。
          item.status = "pending";
          queue.state = "stopped";
          queue.reason = result.message;
          break;
        } else if (result.halt) {
          // 雀魂がエラーを返した(取得制限など)か、応答が無い。続けて要求を送らず、ここで止める。
          item.status = "error";
          item.message = result.message;
          queue.state = "stopped";
          queue.reason = result.message;
          break;
        } else {
          item.status = "error";
          item.message = result.message;
          failures++;
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            queue.state = "stopped";
            queue.reason = `${MAX_CONSECUTIVE_FAILURES}件続けて失敗したため止めました`;
            break;
          }
        }
        await save();
      }

      if (queue.state === "running") {
        if (stopRequested) {
          queue.state = "stopped";
          queue.reason = "止めました";
        } else {
          queue.state = "done";
        }
      }
    } catch (error) {
      console.warn("[牌譜スタッツ出力 リスト取得版] 一括取得が途中で失敗しました", error);
      queue.state = "stopped";
      queue.reason = String((error && error.message) || error);
    } finally {
      for (const item of queue.items) if (item.status === "fetching") item.status = "pending";
      queue.nextAt = 0;
      running = false;
      try {
        await save();
      } catch (error) {
        console.warn("[牌譜スタッツ出力 リスト取得版] 状態を保存できませんでした", error);
      }
    }
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data) return;

    if (data.__mpsl === "record" && data.bytes instanceof ArrayBuffer) {
      // こちらが頼んだ要求への応答にだけ、合言葉(token)が付いている。付いていないものは取り込まない。
      if (typeof data.token !== "string" || !data.token) return;
      const result = await handle(new Uint8Array(data.bytes));
      const resolve = waiting.get(data.token);
      if (resolve) resolve({ ok: result.ok, message: result.message, fatal: false, halt: result.serverError });
    } else if (data.__mpsl === "fetch-failed") {
      const resolve = waiting.get(data.token);
      if (resolve) {
        resolve({
          ok: false,
          message: FAILURE_TEXT[data.reason] || "雀魂に要求を送れませんでした",
          fatal: FATAL_REASONS.has(data.reason),
        });
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    if (message.type === "mps-start") {
      const uuids = Array.isArray(message.uuids) ? message.uuids.filter((uuid) => UUID_PATTERN.test(uuid)) : [];
      if (running) sendResponse({ ok: false, message: "いま取得中です。止めてからやり直してください" });
      else if (!uuids.length) sendResponse({ ok: false, message: "取得できるゲームIDがありません" });
      else {
        const seconds = intervalSeconds(message.intervalSec);
        runQueue(Array.from(new Set(uuids)), seconds * 1000);
        sendResponse({ ok: true, intervalSec: seconds });
      }
    } else if (message.type === "mps-stop") {
      stopRequested = true;
      sendResponse({ ok: true, running });
    }
    return false;
  });

  // 取得の途中でページが読み込み直されると、順番待ちはここで途切れる。
  // 画面に「取得中」のまま残らないよう、止まったことを書いておく。
  chrome.storage.local.get("queue").then(({ queue }) => {
    if (running || !queue || queue.state !== "running") return;
    for (const item of queue.items) if (item.status === "fetching") item.status = "pending";
    queue.state = "stopped";
    queue.reason = "雀魂のページが読み込み直されたため止まりました";
    queue.nextAt = 0;
    return chrome.storage.local.set({ queue });
  });
})();
