// 雀魂の通信定義(liqi.json)から、牌譜の集計に必要な型とフィールドだけを抜き出して
// src/schema.js を生成する。役名テーブル(fan.json)からは src/fans.js を生成する。
//
// 使い方: node tools/gen-assets.mjs
//
// 雀魂側の更新で牌譜の形式が変わったときは、tools/liqi.json と tools/fan.json を
// 新しいものに差し替えてから、このスクリプトを実行し直す。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lq = JSON.parse(readFileSync(join(here, "liqi.json"), "utf8")).nested.lq.nested;
const fan = JSON.parse(readFileSync(join(here, "fan.json"), "utf8"));

// 型名 -> 使うフィールド名。ここに無いフィールドは読み飛ばす。
const WANTED = {
  Wrapper: ["name", "data"],
  ResGameRecord: ["error", "head", "data", "data_url"],
  Error: ["code"],
  RecordGame: ["uuid", "start_time", "end_time", "config", "accounts", "result"],
  "RecordGame.AccountInfo": ["account_id", "seat", "nickname"],
  GameConfig: ["category", "mode", "meta"],
  GameMode: ["mode"],
  GameMetaData: ["room_id", "mode_id", "contest_uid"],
  GameEndResult: ["players"],
  "GameEndResult.PlayerItem": ["seat", "total_point", "part_point_1"],
  GameDetailRecords: ["records", "version", "actions"],
  GameAction: ["result"],
  RecordNewRound: ["chang", "ju", "ben", "scores", "liqibang"],
  RecordDiscardTile: ["seat", "tile", "is_liqi", "moqie", "is_wliqi"],
  RecordDealTile: ["seat", "liqi"],
  RecordChiPengGang: ["seat", "type", "tiles", "froms", "liqi"],
  RecordAnGangAddGang: ["seat", "type", "tiles"],
  RecordBaBei: ["seat"],
  RecordHule: ["hules", "old_scores", "delta_scores", "scores"],
  HuleInfo: [
    "seat", "zimo", "qinjia", "liqi", "yiman", "count", "fans", "fu",
    "point_rong", "point_zimo_qin", "point_zimo_xian", "point_sum", "dadian",
  ],
  FanInfo: ["name", "val", "id"],
  RecordNoTile: ["liujumanguan", "players", "scores"],
  NoTilePlayerInfo: ["tingpai"],
  NoTileScoreInfo: ["seat", "delta_scores"],
  RecordLiuJu: ["type", "seat", "liqi"],
  LiQiSuccess: ["seat", "score", "liqibang", "failed"],
};

const SCALARS = new Set(["string", "bytes", "bool", "uint32", "int32", "uint64", "int64"]);

function lookup(qualified) {
  let node = { nested: lq };
  for (const part of qualified.split(".")) {
    node = node.nested && node.nested[part];
    if (!node) throw new Error(`liqi.json に型がありません: ${qualified}`);
  }
  return node;
}

// フィールドの型名を、WANTED のキー(完全修飾名)に解決する。
function resolveType(owner, type) {
  if (SCALARS.has(type)) return type;
  const nestedName = `${owner}.${type}`;
  if (WANTED[nestedName]) return nestedName;
  if (WANTED[type]) return type;
  throw new Error(`${owner} の型 ${type} が WANTED にありません`);
}

const schema = {};
for (const [typeName, fieldNames] of Object.entries(WANTED)) {
  const def = lookup(typeName);
  const fields = {};
  for (const fieldName of fieldNames) {
    const field = def.fields[fieldName];
    if (!field) throw new Error(`${typeName}.${fieldName} が liqi.json にありません`);
    fields[field.id] = [fieldName, resolveType(typeName, field.type), field.rule === "repeated" ? 1 : 0];
  }
  schema[typeName] = fields;
}

const banner = "// tools/gen-assets.mjs が生成したファイル。手で編集しない。\n";

writeFileSync(
  join(here, "..", "src", "schema.js"),
  `${banner}// 型名 -> { フィールド番号: [名前, 型, 繰り返しか] }\n` +
    `(function (root) {\n  root.MPS = root.MPS || {};\n  root.MPS.schema = ${JSON.stringify(schema, null, 2).replace(/\n/g, "\n  ")};\n` +
    `})(typeof globalThis !== "undefined" ? globalThis : this);\n`,
);

const fans = {};
for (const [id, entry] of Object.entries(fan)) fans[id] = entry.name_jp;
writeFileSync(
  join(here, "..", "src", "fans.js"),
  `${banner}// 役ID -> 役名\n` +
    `(function (root) {\n  root.MPS = root.MPS || {};\n  root.MPS.fans = ${JSON.stringify(fans)};\n` +
    `})(typeof globalThis !== "undefined" ? globalThis : this);\n`,
);

console.log(`schema: ${Object.keys(schema).length} 型 / fans: ${Object.keys(fans).length} 役`);
