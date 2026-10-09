// 貼り付けられた文章や読み込んだCSVから、ゲームIDを拾う。
(function (root) {
  const MPS = (root.MPS = root.MPS || {});
  const UUID = /\d{6}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  // 雀魂の大会の対局一覧CSVで、牌譜のIDが入っている列の見出し。
  const GAME_LIST_COLUMN = "牌譜リンク";
  // この拡張機能が保存するCSV(majsoul-summary など)で、ゲームIDが入っている列の見出し。
  const EXPORTED_COLUMN = "ゲームID";

  function unique(list) {
    return Array.from(new Set(list));
  }

  function uuidsIn(text) {
    return (String(text).match(UUID) || []).map((uuid) => uuid.toLowerCase());
  }

  // 入力欄の文章から拾う。牌譜URLやCSVの1行がそのまま貼られても拾えるようにする。
  // 戻り値: uuids = 見つかったゲームID(重複なし、貼られた順) / unreadable = IDを拾えなかった行の数
  function extract(text) {
    const found = [];
    let unreadable = 0;
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim()) continue;
      const uuids = uuidsIn(line);
      if (uuids.length) found.push(...uuids);
      else unreadable++;
    }
    return { uuids: unique(found), unreadable };
  }

  // ファイルの中身を文字にする。UTF-8で読めなければ、Excelで保存したCSVとみなしてShift_JISで読む。
  function decodeFile(buffer) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
    } catch (error) {
      return new TextDecoder("shift_jis").decode(buffer);
    }
  }

  // CSVを行と列に分ける。"..." で囲まれた値の中のカンマ・改行・"" に対応する。
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    const source = String(text);
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') {
          value += '"';
          i++;
        } else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") {
        row.push(value);
        value = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && source[i + 1] === "\n") i++;
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else value += char;
    }
    if (value !== "" || row.length) {
      row.push(value);
      rows.push(row);
    }
    return rows;
  }

  // 見出しが columnName の列から、ゲームIDを拾う。その見出しの列が無ければ null。
  function fromColumn(text, columnName) {
    const rows = parseCSV(text);
    if (!rows.length) return null;
    const column = rows[0].findIndex((name) => name.trim() === columnName);
    if (column < 0) return null;
    const found = [];
    for (const row of rows.slice(1)) found.push(...uuidsIn(row[column] || ""));
    return unique(found);
  }

  // 対局一覧のCSVから、取得したい対局のゲームIDを拾う。
  // 「牌譜リンク」の列があればその列から、無ければファイル全体から拾う。
  function fromGameList(text) {
    const uuids = fromColumn(text, GAME_LIST_COLUMN);
    return uuids ? { uuids, column: true } : { uuids: unique(uuidsIn(text)), column: false };
  }

  // 以前に保存したCSVから、出力済みの対局のゲームIDを拾う。「ゲームID」の列が無ければ null。
  function fromExported(text) {
    return fromColumn(text, EXPORTED_COLUMN);
  }

  // 以前に保存した集計CSVを、見出しと行のまま読む(次の出力に引き継ぐため)。
  // 「ゲームID」の列が無ければ null。
  function readExported(text) {
    const uuids = fromExported(text);
    if (!uuids) return null;
    const rows = parseCSV(text).filter((row) => row.some((value) => value.trim() !== ""));
    return { uuids, columns: rows[0].map((name) => name.trim()), rows: rows.slice(1) };
  }

  MPS.ids = { extract, decodeFile, parseCSV, fromGameList, fromExported, readExported };
})(typeof globalThis !== "undefined" ? globalThis : this);
