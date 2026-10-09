// 保存領域にある取得済みの対局を読み、表にして見せる。コピーとCSV保存もここで行う。
// リスト取得版: 取得するのは、読み込んだ対局一覧のCSVに載っている牌譜だけ。
(function () {
  const tables = globalThis.MPS.tables;
  const GAME_PREFIX = "game:";
  const ALL = "";
  const LIST_PREFIX = "list:"; // 対象の選択肢のうち、対局一覧のCSVを指すものの値の頭
  const CONFIRM_MS = 4000;

  const el = {
    count: document.getElementById("count"),
    status: document.getElementById("status"),
    empty: document.getElementById("empty"),
    main: document.getElementById("main"),
    target: document.getElementById("target"),
    tableWrap: document.getElementById("table-wrap"),
    copy: document.getElementById("copy"),
    save: document.getElementById("save"),
    header: document.getElementById("header"),
    done: document.getElementById("done"),
    remove: document.getElementById("remove"),
    openTab: document.getElementById("open-tab"),
    bulk: document.getElementById("bulk"),
    bulkList: document.getElementById("bulk-list"),
    bulkStart: document.getElementById("bulk-start"),
    bulkStop: document.getElementById("bulk-stop"),
    bulkResume: document.getElementById("bulk-resume"),
    bulkInterval: document.getElementById("bulk-interval"),
    bulkMessage: document.getElementById("bulk-message"),
    bulkProgress: document.getElementById("bulk-progress"),
    bulkSummary: document.getElementById("bulk-summary"),
    bulkErrors: document.getElementById("bulk-errors"),
    bulkLoadList: document.getElementById("bulk-load-list"),
    bulkLoadExported: document.getElementById("bulk-load-exported"),
    bulkListFile: document.getElementById("bulk-list-file"),
    bulkExportedFile: document.getElementById("bulk-exported-file"),
    bulkExported: document.getElementById("bulk-exported"),
    bulkExportedText: document.getElementById("bulk-exported-text"),
    bulkExportedClear: document.getElementById("bulk-exported-clear"),
  };

  let games = [];
  let lists = {}; // 読み込んだ対局一覧のCSV。ファイル名 -> ゲームIDの配列
  let currentList = ""; // 取得する対局一覧のファイル名(最後に読み込んだか、対象に選んだもの)
  let exported = null; // 出力済みのCSVから読んだ { name, uuids, columns, rows }
  let wantTarget = null; // 次の描画で選びたい対象
  let table = { columns: [], rows: [] };
  let removeArmed = false;
  let removeTimer = 0;
  let doneTimer = 0;

  if (new URLSearchParams(location.search).has("wide")) {
    document.body.classList.add("wide");
    el.openTab.hidden = true;
  }

  function gameLabel(game) {
    const date = new Date(game.endTime * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    const when = `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `${when}  ${game.players.map((player) => player.name).join(" / ")}`;
  }

  // いま選ばれている対象を、{ 対局, 引き継ぐ前回の出力, 対局一覧のファイル名 } にする。
  function scope() {
    const value = el.target.value;
    if (value === ALL) return { games, carried: exported, listName: "" };
    if (value.startsWith(LIST_PREFIX)) {
      const listName = value.slice(LIST_PREFIX.length);
      const uuids = new Set(lists[listName] || []);
      return {
        games: games.filter((game) => uuids.has(game.uuid)),
        carried: tables.limitCarried(exported, uuids),
        listName,
      };
    }
    return { games: games.filter((game) => game.uuid === value), carried: null, listName: "" };
  }

  // 前回の出力に載っていて、拡張機能には残っていない対局の数。
  function carriedCount(carried) {
    return tables.carriedGameIds(games, carried).length;
  }

  function renderTargets() {
    const previous = wantTarget !== null ? wantTarget : el.target.value;
    wantTarget = null;
    el.target.textContent = "";
    el.target.append(new Option(`すべての対局(${games.length + carriedCount(exported)})`, ALL));
    for (const name of Object.keys(lists)) {
      const uuids = new Set(lists[name]);
      const have = games.filter((game) => uuids.has(game.uuid)).length + carriedCount(tables.limitCarried(exported, uuids));
      el.target.append(new Option(`${name} の対局(${have} / ${uuids.size})`, LIST_PREFIX + name));
    }
    // 新しい対局を上に並べる。
    for (const game of games.slice().sort((a, b) => b.endTime - a.endTime)) {
      el.target.append(new Option(gameLabel(game), game.uuid));
    }
    el.target.value = Array.from(el.target.options).some((option) => option.value === previous) ? previous : ALL;
  }

  // 保存するCSVの名前。対局一覧のCSVを対象にしているときは、その名前に続けて付ける。
  function fileName() {
    const { listName } = scope();
    const base = listName ? listName.replace(/\.csv$/i, "") : "majsoul";
    return `${base}-summary.csv`;
  }

  function renderTable() {
    const current = scope();
    table = tables.summaryTable(current.games, current.carried);

    const element = document.createElement("table");
    const head = element.createTHead();

    // 各列が分類の先頭かどうか(縦の区切り線を引くため)。
    const groupStarts = new Set();
    if (table.groups) {
      const groupRow = head.insertRow();
      groupRow.className = "groups";
      let column = 0;
      for (const group of table.groups) {
        const cell = document.createElement("th");
        cell.colSpan = group.span;
        cell.textContent = group.label;
        if (group.label) {
          cell.className = "group-start";
          groupStarts.add(column);
        }
        groupRow.append(cell);
        column += group.span;
      }
    }

    // 数値だけの列は右寄せにする。
    const numeric = table.columns.map((_, index) =>
      table.rows.every((row) => row[index] === "" || typeof row[index] === "number"),
    );
    // ゲームIDは長いので画面では省略表示にする(コピーとCSVには全体が入る)。
    // 集計表の名前の列は、横にスクロールしても見えるよう左端に固定する。
    const idColumn = table.columns.indexOf("ゲームID");
    const pinColumn = table.columns.indexOf("名前");
    const cellClass = (index) =>
      [
        numeric[index] ? "num" : "",
        groupStarts.has(index) ? "group-start" : "",
        index === idColumn ? "game-id" : "",
        index === pinColumn ? "pin" : "",
      ]
        .filter(Boolean)
        .join(" ");

    const columnRow = head.insertRow();
    columnRow.className = "columns";
    table.columns.forEach((name, index) => {
      const cell = document.createElement("th");
      cell.textContent = name;
      cell.className = cellClass(index);
      columnRow.append(cell);
    });

    const body = element.createTBody();
    for (const row of table.rows) {
      const tr = body.insertRow();
      row.forEach((value, index) => {
        const cell = tr.insertCell();
        cell.textContent = value;
        cell.className = cellClass(index);
        if (index === idColumn) cell.title = value;
      });
    }
    if (!table.rows.length) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = table.columns.length;
      cell.textContent = "対局はありません。";
    }

    el.tableWrap.replaceChildren(element);
  }

  function renderRemove() {
    const value = el.target.value;
    if (removeArmed) el.remove.textContent = "もう一度押すと削除";
    else if (value === ALL) el.remove.textContent = "すべての対局を削除";
    else if (value.startsWith(LIST_PREFIX)) el.remove.textContent = "この一覧の対局を削除";
    else el.remove.textContent = "この対局を削除";
    // 削除できるのは拡張機能に残っている対局だけ(前回の出力は「解除」で外す)。
    el.remove.hidden = games.length === 0;
  }

  function disarmRemove() {
    removeArmed = false;
    clearTimeout(removeTimer);
    renderRemove();
  }

  function render() {
    const carriedOnly = carriedCount(exported);
    const has = games.length > 0 || carriedOnly > 0;
    el.empty.hidden = has;
    el.main.hidden = !has;
    el.count.textContent = has
      ? `取得済み ${games.length} 対局` + (carriedOnly ? `、前回の出力から ${carriedOnly} 対局` : "")
      : "";
    if (!has) return;
    renderTable();
    renderRemove();
  }

  function renderStatus(status) {
    // 直近の取り込みが失敗していたときだけ知らせる。
    if (status && !status.ok) {
      el.status.textContent = `直近の牌譜を取り込めませんでした: ${status.message}`;
      el.status.hidden = false;
    } else {
      el.status.hidden = true;
    }
  }

  // ---- 対局一覧のCSVに載っている牌譜の取得 ----
  // 順番待ちは雀魂のタブ側が進める。ここでは開始・停止を頼み、保存領域に書かれた進み具合を表示する。

  const GAME_URLS = [
    "https://game.mahjongsoul.com/*",
    "https://mahjongsoul.game.yo-star.com/*",
    "https://game.maj-soul.com/*",
    "https://game.maj-soul.net/*",
  ];
  const ids = globalThis.MPS.ids;
  let queue = null;
  let bulkOpened = false;

  function say(message, isError) {
    el.bulkMessage.textContent = message;
    el.bulkMessage.classList.toggle("is-error", Boolean(isError));
  }

  function countItems(status) {
    return queue.items.filter((item) => item.status === status).length;
  }

  // 取得する一覧と、その進み具合。
  function renderBulkList() {
    const uuids = lists[currentList];
    el.bulkList.classList.toggle("is-none", !uuids);
    if (!uuids) {
      el.bulkList.textContent = "対局一覧のCSVは、まだ読み込まれていない。";
      return;
    }
    const all = new Set(uuids);
    const have = games.filter((game) => all.has(game.uuid)).length;
    const carried = carriedCount(tables.limitCarried(exported, all));
    const parts = [`${all.size} 対局`, `取得済み ${have}`];
    if (carried) parts.push(`出力済み ${carried}`);
    parts.push(`残り ${all.size - have - carried}`);
    el.bulkList.textContent = `取得する一覧: ${currentList}(${parts.join("、")})`;
  }

  function renderBulk() {
    const isRunning = Boolean(queue) && queue.state === "running";
    const left = queue ? countItems("pending") + countItems("fetching") : 0;
    el.bulkStart.hidden = isRunning;
    renderBulkList();
    el.bulkStop.hidden = !isRunning;
    el.bulkResume.hidden = !(queue && queue.state === "stopped" && left > 0);
    el.bulkInterval.disabled = isRunning;
    el.bulkLoadList.disabled = isRunning;
    el.bulkExported.hidden = !exported;
    if (exported) {
      el.bulkExportedText.textContent = `出力済みの ${exported.uuids.length} 対局は取得せず、集計のCSVに引き継ぐ(${exported.name})`;
    }
    el.bulkProgress.hidden = !queue;
    if (!queue) return;

    const ok = countItems("ok");
    const skip = countItems("skip");
    const error = countItems("error");
    const tally = `取得 ${ok} 件、取得済みで省略 ${skip} 件、出力済みで省略 ${countItems("exported")} 件、失敗 ${error} 件`;
    if (isRunning) {
      const wait = Math.max(0, Math.ceil((queue.nextAt - Date.now()) / 1000));
      let step = "";
      if (queue.nextAt) step = `次の取得まで ${wait} 秒。`;
      else if (countItems("fetching")) step = "雀魂の応答を待っている。";
      const minutes = Math.ceil((left * queue.intervalMs) / 60000);
      el.bulkSummary.textContent = `取得中 ${queue.items.length - left} / ${queue.items.length} 件。${step}残り約 ${minutes} 分。`;
    } else if (queue.state === "done") {
      el.bulkSummary.textContent = `完了。${tally}。`;
    } else {
      el.bulkSummary.textContent = `停止: ${queue.reason}。${tally}、未取得 ${left} 件。`;
    }

    el.bulkErrors.replaceChildren(
      ...queue.items
        .filter((item) => item.status === "error")
        .map((item) => {
          const line = document.createElement("li");
          line.textContent = `${item.uuid}: ${item.message}`;
          return line;
        }),
    );
  }

  // 雀魂のタブに頼む。開始は1つのタブが引き受けたら終わり、停止は全部のタブに伝える。
  async function askGame(message, everyTab) {
    const tabs = await chrome.tabs.query({ url: GAME_URLS });
    if (!tabs.length) return { ok: false, message: "雀魂のタブが開かれていません" };
    tabs.sort((a, b) => Number(b.active) - Number(a.active));
    let answer = { ok: false, message: "雀魂のタブを再読み込みしてからやり直してください" };
    for (const tab of tabs) {
      try {
        const reply = await chrome.tabs.sendMessage(tab.id, message);
        if (!reply) continue;
        answer = reply;
        if (reply.ok && !everyTab) break;
      } catch (error) {
        // 拡張機能を入れる前から開いていたタブには届かない。
      }
    }
    return answer;
  }

  async function startBulk(uuids, note) {
    el.bulkStart.disabled = true;
    el.bulkResume.disabled = true;
    try {
      const reply = await askGame({ type: "mps-start", uuids, intervalSec: Number(el.bulkInterval.value) }, false);
      say(reply.ok ? note : reply.message, !reply.ok);
      if (reply.ok) {
        // 範囲の外の値は雀魂のタブ側で直されるので、実際に使う秒数を欄に戻して覚えておく。
        el.bulkInterval.value = reply.intervalSec;
        await chrome.storage.local.set({ intervalSec: reply.intervalSec });
      }
      return reply.ok;
    } finally {
      el.bulkStart.disabled = false;
      el.bulkResume.disabled = false;
    }
  }

  el.bulkStart.addEventListener("click", async () => {
    const uuids = lists[currentList];
    if (!uuids || !uuids.length) {
      say("先に、対局一覧のCSVを読み込んでください", true);
      return;
    }
    await startBulk(uuids, "");
  });

  el.bulkResume.addEventListener("click", () => {
    const rest = queue.items.filter((item) => item.status === "pending" || item.status === "fetching");
    startBulk(rest.map((item) => item.uuid), "");
  });

  // ---- CSVの読み込み ----

  async function readCSV(input) {
    const file = input.files[0];
    input.value = ""; // 同じファイルを選び直しても反応するように
    if (!file) return null;
    return { name: file.name, text: ids.decodeFile(await file.arrayBuffer()) };
  }

  el.bulkLoadList.addEventListener("click", () => el.bulkListFile.click());
  el.bulkLoadExported.addEventListener("click", () => el.bulkExportedFile.click());

  // 対局一覧のCSV: 「牌譜リンク」の列のゲームIDを読み、取得する一覧にする。
  el.bulkListFile.addEventListener("change", async () => {
    try {
      const file = await readCSV(el.bulkListFile);
      if (!file) return;
      const found = ids.fromGameList(file.text);
      if (!found.uuids.length) {
        say(`${file.name} にゲームIDが見つかりません`, true);
        return;
      }
      // この一覧を覚えておき、取得する一覧と、表の対象と、保存するCSVの名前に使う。
      wantTarget = LIST_PREFIX + file.name;
      await chrome.storage.local.set({ lists: { ...lists, [file.name]: found.uuids }, currentList: file.name });

      const notes = [`${file.name} から ${found.uuids.length} 件を読み込んだ`];
      if (!found.column) notes.push("「牌譜リンク」の列が無いため、ファイル全体から拾った");
      if (exported) {
        const done = new Set(exported.uuids);
        notes.push(`うち出力済みの ${found.uuids.filter((uuid) => done.has(uuid)).length} 件は取得しない`);
      }
      say(notes.join("。") + "。", false);
    } catch (error) {
      say("CSVを読み込めませんでした", true);
    }
  });

  // 出力済みのCSV(以前に保存した集計のCSV): 「ゲームID」の列に載っている対局は、以後取得しない。
  // 行はそのまま覚えておき、次に保存する集計のCSVに書き込む。
  el.bulkExportedFile.addEventListener("change", async () => {
    try {
      const file = await readCSV(el.bulkExportedFile);
      if (!file) return;
      const read = ids.readExported(file.text);
      if (!read) {
        say(`${file.name} に「ゲームID」の列がありません。「集計」の表を保存したCSV(…-summary.csv)を選んでください`, true);
        return;
      }
      // 和了や立直のCSVにもゲームIDの列はあるが、集計の行としては引き継げない。
      if (!["名前", "局数"].every((name) => read.columns.includes(name))) {
        say(`${file.name} は集計のCSVではありません。「集計」の表を保存したCSV(…-summary.csv)を選んでください`, true);
        return;
      }
      await chrome.storage.local.set({ exported: { name: file.name, ...read } });
      say(`${file.name} から出力済みの ${read.uuids.length} 対局を読み込んだ。`, false);
    } catch (error) {
      say("CSVを読み込めませんでした", true);
    }
  });

  el.bulkExportedClear.addEventListener("click", async () => {
    await chrome.storage.local.remove("exported");
    say("", false);
  });

  el.bulkStop.addEventListener("click", async () => {
    say("", false);
    await askGame({ type: "mps-stop" }, true);
  });

  // 「次の取得まで○秒」を進める。
  setInterval(() => {
    if (queue && queue.state === "running") renderBulk();
  }, 1000);

  async function load() {
    const all = await chrome.storage.local.get(null);
    games = Object.keys(all)
      .filter((key) => key.startsWith(GAME_PREFIX))
      .map((key) => all[key]);
    queue = all.queue || null;
    exported = all.exported || null;
    // 入力の途中で書き換えないよう、欄を触っていないときだけ覚えている待機時間を入れる。
    if (all.intervalSec && document.activeElement !== el.bulkInterval) el.bulkInterval.value = all.intervalSec;
    lists = all.lists || {};
    currentList = all.currentList || "";
    // 最初に開いたときは、最後に読み込んだ対局一覧を対象にしておく。
    if (!bulkOpened && wantTarget === null && lists[currentList]) wantTarget = LIST_PREFIX + currentList;
    if (!bulkOpened) {
      // 最初に開いたときだけ、使いそうな状況なら欄を広げておく。
      bulkOpened = true;
      el.bulk.open = games.length === 0 || (queue !== null && queue.state !== "done");
    }
    renderStatus(all.status);
    renderBulk();
    renderTargets();
    render();
  }

  function flash(message) {
    el.done.textContent = message;
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => (el.done.textContent = ""), 2500);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // クリップボードAPIが使えない環境向けの古い方法。
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (!ok) throw error;
    }
  }

  el.target.addEventListener("change", () => {
    disarmRemove();
    render();
    // 対象に対局一覧を選んだら、取得する一覧もそれに合わせる。
    const value = el.target.value;
    if (value.startsWith(LIST_PREFIX) && value.slice(LIST_PREFIX.length) !== currentList) {
      chrome.storage.local.set({ currentList: value.slice(LIST_PREFIX.length) });
    }
  });


  el.copy.addEventListener("click", async () => {
    try {
      await copyText(tables.toTSV(table, el.header.checked));
      flash(`コピーした(${table.rows.length} 行)`);
    } catch (error) {
      flash("コピーできなかった");
    }
  });

  el.save.addEventListener("click", async () => {
    // 保存先を選ぶ画面は、裏で動く側(background.js)がブラウザに出させる。
    try {
      const reply = await chrome.runtime.sendMessage({ type: "mps-save-csv", filename: fileName(), text: tables.toCSV(table) });
      if (reply && reply.ok) flash("CSVを保存した");
      else flash(reply && reply.canceled ? "保存をやめた" : "保存できなかった");
    } catch (error) {
      flash("保存できなかった");
    }
  });

  el.remove.addEventListener("click", async () => {
    if (!removeArmed) {
      removeArmed = true;
      renderRemove();
      removeTimer = setTimeout(disarmRemove, CONFIRM_MS);
      return;
    }
    const current = scope();
    const keys = current.games.map((game) => GAME_PREFIX + game.uuid);
    disarmRemove();
    if (current.listName) {
      // 一覧の対局を消すときは、一覧そのものも忘れる。
      const rest = { ...lists };
      delete rest[current.listName];
      // 取得する一覧を消したときは、残っている一覧(最後に読み込んだもの)に替える。
      const next = currentList === current.listName ? Object.keys(rest).pop() || "" : currentList;
      await chrome.storage.local.set({ lists: rest, currentList: next });
    }
    await chrome.storage.local.remove(keys);
    flash("削除した");
  });

  el.openTab.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html?wide") });
  });

  // ポップアップを開いたまま取得が進むと、表がその場で増える。
  chrome.storage.onChanged.addListener(load);
  load();
})();
