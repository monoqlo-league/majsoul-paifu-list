// analyze.js が作った対局データから、画面と出力に使う集計表(列名と行)を組み立てる。
(function (root) {
  const MPS = (root.MPS = root.MPS || {});

  function average(total, count, digits) {
    if (!count) return "";
    const scale = Math.pow(10, digits);
    return Math.round((total / count) * scale) / scale;
  }

  function byEndTime(games) {
    return games.slice().sort((a, b) => a.endTime - b.endTime || (a.uuid < b.uuid ? -1 : 1));
  }

  // ---- 役の列 ----
  // 雀魂が和了の役として記録するもの(古役を含む)を、1役1列にする。
  // ドラ・赤ドラ・裏ドラ・抜きドラは役ではなく枚数として別の列に出すので、ここには入れない。
  const DORA_FAN_IDS = new Set([31, 32, 33, 34]);
  const LAST_YAKU_FAN_ID = 65; // これより大きい番号は、イベント用や四川麻雀用の役
  const OTHER_YAKU = "その他の役";
  const YAKU_COLUMNS = [];
  for (let id = 1; id <= LAST_YAKU_FAN_ID; id++) {
    const name = MPS.fans && MPS.fans[id];
    // 人和のように、同じ名前で番号が2つある役は1列にまとめる。
    if (name && !DORA_FAN_IDS.has(id) && !YAKU_COLUMNS.includes(name)) YAKU_COLUMNS.push(name);
  }

  // 和了の明細に入っている「七対子(2)、立直(1)」のような役の欄から、役の名前を取り出す。
  function yakuNames(hule) {
    return String(hule.yaku || "")
      .split("、")
      .map((piece) => piece.replace(/\(\d+\)$/, ""))
      .filter(Boolean);
  }

  function emptyStats() {
    return {
      rounds: 0,
      wins: 0,
      winPoints: 0,
      winTurns: 0,
      maxWinPoints: 0,
      tsumoWins: 0,
      ronWins: 0,
      damaWins: 0,
      yakumanWins: 0,
      dora: 0,
      akaDora: 0,
      uraDora: 0,
      dealIns: 0,
      dealInPoints: 0,
      dealInsAfterRiichi: 0,
      dealInsOnRiichiTile: 0,
      riichis: 0,
      riichiTurns: 0,
      riichiWins: 0,
      riichiFirst: 0,
      riichiChase: 0,
      callRounds: 0,
      callWins: 0,
      callCount: 0,
      yaku: new Map(), // 役の名前 -> その役が付いた和了の回数
      otherYaku: 0,
    };
  }

  // 1対局ぶんの明細を、席 seat のプレイヤーの stats に足し込む。
  function addGame(stats, game, seat) {
    stats.rounds += game.roundCount;
    stats.callRounds += game.callRounds[seat];
    stats.callCount += game.callCount[seat];

    // 放銃は局単位で数える(ダブロンは1回。点数は両方を足す)。
    const dealInRounds = new Set();
    const dealInRoundsAfterRiichi = new Set();
    const dealInRoundsOnRiichiTile = new Set();
    for (const hule of game.hules) {
      if (hule.winner === seat) {
        stats.wins++;
        stats.winPoints += hule.points;
        stats.winTurns += hule.turn;
        stats.maxWinPoints = Math.max(stats.maxWinPoints, hule.points);
        if (hule.zimo) stats.tsumoWins++;
        else stats.ronWins++;
        if (hule.winnerState === "ダマ") stats.damaWins++;
        if (hule.yakuman) stats.yakumanWins++;
        stats.dora += hule.dora;
        stats.akaDora += hule.akaDora;
        stats.uraDora += hule.uraDora;
        if (hule.winnerCalls > 0) stats.callWins++;
        for (const name of yakuNames(hule)) {
          if (YAKU_COLUMNS.includes(name)) stats.yaku.set(name, (stats.yaku.get(name) || 0) + 1);
          else stats.otherYaku++;
        }
      }
      if (hule.loser === seat) {
        dealInRounds.add(hule.roundIndex);
        stats.dealInPoints += hule.points;
        if (hule.loserState === "立直中") dealInRoundsAfterRiichi.add(hule.roundIndex);
        if (hule.loserState === "立直宣言牌") dealInRoundsOnRiichiTile.add(hule.roundIndex);
      }
    }
    stats.dealIns += dealInRounds.size;
    stats.dealInsAfterRiichi += dealInRoundsAfterRiichi.size;
    stats.dealInsOnRiichiTile += dealInRoundsOnRiichiTile.size;

    for (const riichi of game.riichis) {
      if (riichi.seat !== seat || !riichi.established) continue;
      stats.riichis++;
      stats.riichiTurns += riichi.turn;
      stats.riichiWins += riichi.win;
      stats.riichiFirst += riichi.first;
      stats.riichiChase += riichi.chase;
    }
  }

  // 集計表の列を分類でまとめるための見出し(画面表示用)。各分類の列の並びは STAT_COLUMNS と同じ。
  const STAT_GROUPS = [
    { label: "和了", span: 13 },
    { label: "放銃", span: 5 },
    { label: "立直", span: 6 },
    { label: "副露", span: 3 },
    { label: "役", span: YAKU_COLUMNS.length + 1 },
  ];

  const STAT_COLUMNS = [
    "局数", "最大連荘数",
    "和了数", "和了点合計", "和了点平均", "最高和了点", "和了巡目合計", "和了巡目平均",
    "ツモ和了", "ロン和了", "ダマ和了", "役満和了", "ドラ", "赤ドラ", "裏ドラ",
    "放銃数", "放銃点合計", "放銃点平均", "立直後放銃", "宣言牌放銃",
    "立直数", "立直巡目合計", "立直巡目平均", "立直和了", "先制立直", "追っかけ立直",
    "副露局数", "副露和了", "副露回数",
  ].concat(YAKU_COLUMNS, [OTHER_YAKU]);

  // 最大連荘数(親を続けた局数の最大)。取り込んだ版によって持ち方が違う。
  function maxDealerRun(game, seat) {
    if (game.maxDealerRun) return game.maxDealerRun[seat];
    // v0.8.0 は「親が続いた回数」(3局続けたら2)で記録していたので、1を足して局数に直す。
    // この版の記録では「親番が一度も来なかった」と「1局で流れた」を区別できず、どちらも1になる。
    if (game.maxRenchan) return game.maxRenchan[seat] + 1;
    return ""; // それより前の版には記録が無い
  }

  function statCells(stats, dealerRun) {
    return [
      stats.rounds, dealerRun,
      stats.wins, stats.winPoints, average(stats.winPoints, stats.wins, 0), stats.wins ? stats.maxWinPoints : "",
      stats.winTurns, average(stats.winTurns, stats.wins, 1),
      stats.tsumoWins, stats.ronWins, stats.damaWins, stats.yakumanWins,
      stats.dora, stats.akaDora, stats.uraDora,
      stats.dealIns, stats.dealInPoints, average(stats.dealInPoints, stats.dealIns, 0),
      stats.dealInsAfterRiichi, stats.dealInsOnRiichiTile,
      stats.riichis, stats.riichiTurns, average(stats.riichiTurns, stats.riichis, 1),
      stats.riichiWins, stats.riichiFirst, stats.riichiChase,
      stats.callRounds, stats.callWins, stats.callCount,
    ].concat(YAKU_COLUMNS.map((name) => stats.yaku.get(name) || 0), [stats.otherYaku]);
  }

  const KEY_COLUMNS = ["ゲームID", "名前", "内部ID"];
  const SUMMARY_COLUMNS = KEY_COLUMNS.concat(STAT_COLUMNS);
  const SUMMARY_GROUPS = [{ label: "", span: 5 }].concat(STAT_GROUPS);
  // 数字に見えても文字のまま扱う列(名前が「123」のプレイヤーもいる)。
  const TEXT_COLUMNS = new Set(["ゲームID", "名前"]);

  // ---- 以前に保存した集計CSV(前回の出力)の引き継ぎ ----
  // carried は { columns: 見出し, rows: 行 }。値はCSVから読んだ文字のまま。

  function carriedIdColumn(carried) {
    return carried ? carried.columns.findIndex((name) => String(name).trim() === "ゲームID") : -1;
  }

  function gameIdOf(row, idAt) {
    return String(row[idAt] || "").trim().toLowerCase();
  }

  // 前回の出力のうち、ゲームIDが uuids に含まれる行だけを残す。
  function limitCarried(carried, uuids) {
    const idAt = carriedIdColumn(carried);
    if (idAt < 0) return null;
    return { columns: carried.columns, rows: carried.rows.filter((row) => uuids.has(gameIdOf(row, idAt))) };
  }

  // 前回の出力の行を、いまの集計表の列の並びに直す。前回のCSVに無い列は空欄になる。
  // 拡張機能に残っている対局(games)は取り込み済みのデータから作り直すので、ここでは除く。
  function carriedSummaryRows(games, carried) {
    const idAt = carriedIdColumn(carried);
    if (idAt < 0) return [];
    const stored = new Set(games.map((game) => game.uuid));
    const from = SUMMARY_COLUMNS.map((name) => carried.columns.findIndex((column) => String(column).trim() === name));
    const rows = [];
    for (const source of carried.rows) {
      const uuid = gameIdOf(source, idAt);
      if (!uuid || stored.has(uuid)) continue;
      rows.push(
        from.map((at, column) => {
          const value = at < 0 || source[at] == null ? "" : String(source[at]).trim();
          if (column === 0) return uuid;
          if (TEXT_COLUMNS.has(SUMMARY_COLUMNS[column])) return value;
          return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
        }),
      );
    }
    return rows;
  }

  // 集計表。1行=1対局の1人。前回の出力(carried)があれば、その行を先に並べる。
  function summaryTable(games, carried) {
    const rows = carriedSummaryRows(games, carried);
    for (const game of byEndTime(games)) {
      for (const player of game.players) {
        const stats = emptyStats();
        addGame(stats, game, player.seat);
        rows.push(
          [game.uuid, player.name, player.accountId || ""].concat(statCells(stats, maxDealerRun(game, player.seat))),
        );
      }
    }
    return { columns: SUMMARY_COLUMNS, groups: SUMMARY_GROUPS, rows };
  }

  // 前回の出力に載っている対局のうち、拡張機能に残っていないもののゲームID。
  function carriedGameIds(games, carried) {
    return Array.from(new Set(carriedSummaryRows(games, carried).map((row) => row[0])));
  }

  // タブや改行を含む値は表を壊すので空白に置き換える(プレイヤー名に入りうる)。
  function toTSV(table, withHeader) {
    const clean = (value) => String(value).replace(/[\t\r\n]+/g, " ");
    const lines = table.rows.map((row) => row.map(clean).join("\t"));
    if (withHeader) lines.unshift(table.columns.map(clean).join("\t"));
    return lines.join("\n") + "\n";
  }

  function toCSV(table) {
    const quote = (value) => {
      const text = String(value);
      return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    const lines = [table.columns].concat(table.rows).map((row) => row.map(quote).join(","));
    return lines.join("\r\n") + "\r\n";
  }

  MPS.tables = { summaryTable, limitCarried, carriedGameIds, toTSV, toCSV, YAKU_COLUMNS };
})(typeof globalThis !== "undefined" ? globalThis : this);
