// tools/gen-assets.mjs が生成したファイル。手で編集しない。
// 型名 -> { フィールド番号: [名前, 型, 繰り返しか] }
(function (root) {
  root.MPS = root.MPS || {};
  root.MPS.schema = {
    "Wrapper": {
      "1": [
        "name",
        "string",
        0
      ],
      "2": [
        "data",
        "bytes",
        0
      ]
    },
    "ResGameRecord": {
      "1": [
        "error",
        "Error",
        0
      ],
      "3": [
        "head",
        "RecordGame",
        0
      ],
      "4": [
        "data",
        "bytes",
        0
      ],
      "5": [
        "data_url",
        "string",
        0
      ]
    },
    "Error": {
      "1": [
        "code",
        "uint32",
        0
      ]
    },
    "RecordGame": {
      "1": [
        "uuid",
        "string",
        0
      ],
      "2": [
        "start_time",
        "uint32",
        0
      ],
      "3": [
        "end_time",
        "uint32",
        0
      ],
      "5": [
        "config",
        "GameConfig",
        0
      ],
      "11": [
        "accounts",
        "RecordGame.AccountInfo",
        1
      ],
      "12": [
        "result",
        "GameEndResult",
        0
      ]
    },
    "RecordGame.AccountInfo": {
      "1": [
        "account_id",
        "uint32",
        0
      ],
      "2": [
        "seat",
        "uint32",
        0
      ],
      "3": [
        "nickname",
        "string",
        0
      ]
    },
    "GameConfig": {
      "1": [
        "category",
        "uint32",
        0
      ],
      "2": [
        "mode",
        "GameMode",
        0
      ],
      "3": [
        "meta",
        "GameMetaData",
        0
      ]
    },
    "GameMode": {
      "1": [
        "mode",
        "uint32",
        0
      ]
    },
    "GameMetaData": {
      "1": [
        "room_id",
        "uint32",
        0
      ],
      "2": [
        "mode_id",
        "uint32",
        0
      ],
      "3": [
        "contest_uid",
        "uint32",
        0
      ]
    },
    "GameEndResult": {
      "1": [
        "players",
        "GameEndResult.PlayerItem",
        1
      ]
    },
    "GameEndResult.PlayerItem": {
      "1": [
        "seat",
        "uint32",
        0
      ],
      "2": [
        "total_point",
        "int32",
        0
      ],
      "3": [
        "part_point_1",
        "int32",
        0
      ]
    },
    "GameDetailRecords": {
      "1": [
        "records",
        "bytes",
        1
      ],
      "2": [
        "version",
        "uint32",
        0
      ],
      "3": [
        "actions",
        "GameAction",
        1
      ]
    },
    "GameAction": {
      "3": [
        "result",
        "bytes",
        0
      ]
    },
    "RecordNewRound": {
      "1": [
        "chang",
        "uint32",
        0
      ],
      "2": [
        "ju",
        "uint32",
        0
      ],
      "3": [
        "ben",
        "uint32",
        0
      ],
      "5": [
        "scores",
        "int32",
        1
      ],
      "6": [
        "liqibang",
        "uint32",
        0
      ]
    },
    "RecordDiscardTile": {
      "1": [
        "seat",
        "uint32",
        0
      ],
      "2": [
        "tile",
        "string",
        0
      ],
      "3": [
        "is_liqi",
        "bool",
        0
      ],
      "5": [
        "moqie",
        "bool",
        0
      ],
      "9": [
        "is_wliqi",
        "bool",
        0
      ]
    },
    "RecordDealTile": {
      "1": [
        "seat",
        "uint32",
        0
      ],
      "5": [
        "liqi",
        "LiQiSuccess",
        0
      ]
    },
    "RecordChiPengGang": {
      "1": [
        "seat",
        "uint32",
        0
      ],
      "2": [
        "type",
        "uint32",
        0
      ],
      "3": [
        "tiles",
        "string",
        1
      ],
      "4": [
        "froms",
        "uint32",
        1
      ],
      "5": [
        "liqi",
        "LiQiSuccess",
        0
      ]
    },
    "RecordAnGangAddGang": {
      "1": [
        "seat",
        "uint32",
        0
      ],
      "2": [
        "type",
        "uint32",
        0
      ],
      "3": [
        "tiles",
        "string",
        0
      ]
    },
    "RecordBaBei": {
      "1": [
        "seat",
        "uint32",
        0
      ]
    },
    "RecordHule": {
      "1": [
        "hules",
        "HuleInfo",
        1
      ],
      "2": [
        "old_scores",
        "int32",
        1
      ],
      "3": [
        "delta_scores",
        "int32",
        1
      ],
      "5": [
        "scores",
        "int32",
        1
      ]
    },
    "HuleInfo": {
      "4": [
        "seat",
        "uint32",
        0
      ],
      "5": [
        "zimo",
        "bool",
        0
      ],
      "6": [
        "qinjia",
        "bool",
        0
      ],
      "7": [
        "liqi",
        "bool",
        0
      ],
      "10": [
        "yiman",
        "bool",
        0
      ],
      "11": [
        "count",
        "uint32",
        0
      ],
      "12": [
        "fans",
        "FanInfo",
        1
      ],
      "13": [
        "fu",
        "uint32",
        0
      ],
      "15": [
        "point_rong",
        "uint32",
        0
      ],
      "16": [
        "point_zimo_qin",
        "uint32",
        0
      ],
      "17": [
        "point_zimo_xian",
        "uint32",
        0
      ],
      "19": [
        "point_sum",
        "uint32",
        0
      ],
      "20": [
        "dadian",
        "uint32",
        0
      ]
    },
    "FanInfo": {
      "1": [
        "name",
        "string",
        0
      ],
      "2": [
        "val",
        "uint32",
        0
      ],
      "3": [
        "id",
        "uint32",
        0
      ]
    },
    "RecordNoTile": {
      "1": [
        "liujumanguan",
        "bool",
        0
      ],
      "2": [
        "players",
        "NoTilePlayerInfo",
        1
      ],
      "3": [
        "scores",
        "NoTileScoreInfo",
        1
      ]
    },
    "NoTilePlayerInfo": {
      "3": [
        "tingpai",
        "bool",
        0
      ]
    },
    "NoTileScoreInfo": {
      "1": [
        "seat",
        "uint32",
        0
      ],
      "3": [
        "delta_scores",
        "int32",
        1
      ]
    },
    "RecordLiuJu": {
      "1": [
        "type",
        "uint32",
        0
      ],
      "3": [
        "seat",
        "uint32",
        0
      ],
      "5": [
        "liqi",
        "LiQiSuccess",
        0
      ]
    },
    "LiQiSuccess": {
      "1": [
        "seat",
        "uint32",
        0
      ],
      "2": [
        "score",
        "int32",
        0
      ],
      "3": [
        "liqibang",
        "uint32",
        0
      ],
      "4": [
        "failed",
        "bool",
        0
      ]
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
