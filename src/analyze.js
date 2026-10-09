// 牌譜1対局ぶんの局イベントを読み、和了・放銃・立直・副露の明細を取り出す。
// ブラウザにも通信にも触れない純粋な計算だけを置く(テストから直接呼べるようにするため)。
//
// 用語の定義(README にも同じ内容を書いてある):
//   巡目     その出来事が起きた手番が、手番の持ち主にとって何回目か。
//            立直 = 宣言牌が本人の何打目か / ツモ和了 = 本人の打牌数+1 / ロン和了 = 放銃牌が放銃者の何打目か。
//   和了点   手の点数(雀魂の「打点」)。本場と供託は含まない。
//   先制     他家の立直が成立していない状態での立直。そうでなければ追っかけ。
//   副露     チー・ポン・大明槓。暗槓と加槓と北抜きは数えない。
(function (root) {
  const MPS = (root.MPS = root.MPS || {});

  const WINDS = ["東", "南", "西", "北"];
  const FAN_DOUBLE_RIICHI = 18;
  const FAN_IPPATSU = 30;
  const FAN_DORA = 31;
  const FAN_AKA_DORA = 32;
  const FAN_URA_DORA = 33;
  const FAN_NUKI_DORA = 34;
  const DORA_FANS = new Set([FAN_DORA, FAN_AKA_DORA, FAN_URA_DORA, FAN_NUKI_DORA]);

  const CALL_CHI = 0;
  const CALL_PON = 1;
  const CALL_DAIMINKAN = 2;

  function fanName(fan) {
    return (MPS.fans && MPS.fans[fan.id]) || fan.name || "#" + fan.id;
  }

  function fanValue(fans, id) {
    let total = 0;
    for (const fan of fans) if (fan.id === id) total += fan.val;
    return total;
  }

  // 手の点数。古い牌譜には dadian が無いことがあるので、その場合は支払い額から組み立てる。
  function handPoints(hule, playerCount) {
    if (hule.dadian) return hule.dadian;
    if (hule.point_sum) return hule.point_sum;
    if (!hule.zimo) return hule.point_rong;
    if (hule.qinjia) return hule.point_zimo_xian * (playerCount - 1);
    return hule.point_zimo_qin + hule.point_zimo_xian * (playerCount - 2);
  }

  function newRoundState(event, index, playerCount) {
    return {
      index,
      chang: event.chang,
      ju: event.ju,
      ben: event.ben,
      label: (WINDS[event.chang] || "?") + (event.ju + 1) + "局",
      discards: new Array(playerCount).fill(0),
      calls: new Array(playerCount).fill(0),
      riichi: new Array(playerCount).fill(false), // 成立した立直
      pendingRiichi: null, // 宣言牌を切った直後で、まだ成立が確定していない立直
      lastActor: -1,
      lastWasDiscard: false,
      riichis: [],
    };
  }

  // head: 牌譜のヘッダ(RecordGame) / actions: pb.decodeDetail の結果
  function analyzeGame(head, actions) {
    const playerCount = head.result && head.result.players.length ? head.result.players.length : 4;

    const players = [];
    for (let seat = 0; seat < playerCount; seat++) players.push({ seat, name: "CPU", accountId: 0 });
    for (const account of head.accounts || []) {
      if (account.seat < playerCount) {
        players[account.seat].name = account.nickname;
        players[account.seat].accountId = account.account_id;
      }
    }

    const game = {
      uuid: head.uuid,
      startTime: head.start_time,
      endTime: head.end_time,
      playerCount,
      players,
      roundCount: 0,
      // 席ごとの、明細からは数えられない値
      callRounds: new Array(playerCount).fill(0),
      callCount: new Array(playerCount).fill(0),
      // 席ごとの最大連荘数。親を続けた局数の最大(親を3局続けたら3、1局で流れたら1、親番が来なければ0)。
      maxDealerRun: new Array(playerCount).fill(0),
      hules: [],
      riichis: [],
      unknownActions: [],
    };

    let round = null;
    let dealer = { chang: -1, ju: -1, streak: 0 }; // いまの親番と、その親が続けている局数

    // 宣言牌がロンされなかったので、立直を成立させる。
    function settlePendingRiichi() {
      if (!round || !round.pendingRiichi) return;
      const pending = round.pendingRiichi;
      round.pendingRiichi = null;
      pending.established = 1;
      round.riichi[pending.seat] = true;
    }

    function closeRound(resultOf) {
      for (const riichi of round.riichis) {
        const result = resultOf(riichi);
        riichi.result = result.text;
        riichi.win = result.win ? 1 : 0;
        riichi.points = result.points;
        game.riichis.push(riichi);
      }
      for (let seat = 0; seat < playerCount; seat++) {
        if (round.calls[seat] > 0) game.callRounds[seat]++;
        game.callCount[seat] += round.calls[seat];
      }
      round = null;
    }

    for (const action of actions) {
      const event = action.data;
      if (action.name === "RecordNewRound") {
        // 終了イベントの無いまま次の局が始まった場合も、立直と副露を取りこぼさない。
        if (round) closeRound(() => ({ text: "不明", win: false, points: 0 }));
        round = newRoundState(event, game.roundCount, playerCount);
        game.roundCount++;
        // 場と局が前の局と同じなら、親が続いている(和了でも聴牌流局でも連荘)。
        if (event.chang === dealer.chang && event.ju === dealer.ju) dealer.streak++;
        else dealer = { chang: event.chang, ju: event.ju, streak: 1 };
        if (event.ju < playerCount && dealer.streak > game.maxDealerRun[event.ju]) game.maxDealerRun[event.ju] = dealer.streak;
        continue;
      }
      if (!round) continue;

      switch (action.name) {
        case "RecordDiscardTile": {
          settlePendingRiichi();
          round.discards[event.seat]++;
          round.lastActor = event.seat;
          round.lastWasDiscard = true;
          if (event.is_liqi || event.is_wliqi) {
            const others = round.riichi.filter(Boolean).length;
            const riichi = {
              uuid: game.uuid,
              roundIndex: round.index,
              round: round.label,
              honba: round.ben,
              seat: event.seat,
              turn: round.discards[event.seat],
              order: others + 1,
              first: others === 0 ? 1 : 0,
              chase: others === 0 ? 0 : 1,
              double: event.is_wliqi ? 1 : 0,
              established: 0,
              result: "",
              win: 0,
              points: 0,
            };
            round.riichis.push(riichi);
            round.pendingRiichi = riichi;
          }
          break;
        }
        case "RecordDealTile":
          settlePendingRiichi();
          break;
        case "RecordChiPengGang":
          settlePendingRiichi();
          if (event.type === CALL_CHI || event.type === CALL_PON || event.type === CALL_DAIMINKAN) {
            round.calls[event.seat]++;
          }
          break;
        case "RecordAnGangAddGang":
        case "RecordBaBei":
          // 槍槓や北抜きへのロンでは、この席が放銃者になる。
          settlePendingRiichi();
          round.lastActor = event.seat;
          round.lastWasDiscard = false;
          break;
        case "RecordHule": {
          const isRon = event.hules.some((hule) => !hule.zimo);
          const loser = isRon ? round.lastActor : -1;
          // 宣言牌でロンされた立直は成立しない(供託も出ない)。ツモ和了なら成立している。
          const failedRiichi = isRon ? round.pendingRiichi : null;
          if (failedRiichi) round.pendingRiichi = null;
          else settlePendingRiichi();

          let loserState = "";
          if (isRon) {
            if (failedRiichi && failedRiichi.seat === loser) loserState = "立直宣言牌";
            else if (round.riichi[loser]) loserState = "立直中";
            else if (round.calls[loser] > 0) loserState = "副露";
            else loserState = "門前";
          }

          let paid = 0;
          const winners = new Map();
          for (const hule of event.hules) {
            const points = handPoints(hule, playerCount);
            const winnerRiichi = hule.liqi || round.riichi[hule.seat];
            let turn;
            if (hule.zimo) turn = round.discards[hule.seat] + 1;
            else turn = round.lastWasDiscard ? round.discards[loser] : round.discards[loser] + 1;
            const yaku = hule.fans
              .filter((fan) => !DORA_FANS.has(fan.id))
              .map((fan) => fanName(fan) + (hule.yiman ? "" : "(" + fan.val + ")"));
            game.hules.push({
              uuid: game.uuid,
              roundIndex: round.index,
              round: round.label,
              honba: round.ben,
              winner: hule.seat,
              zimo: hule.zimo ? 1 : 0,
              loser: hule.zimo ? -1 : loser,
              points,
              turn,
              han: hule.yiman ? 0 : hule.count,
              fu: hule.yiman ? 0 : hule.fu,
              yakuman: hule.yiman ? hule.count : 0,
              yaku: yaku.join("、"),
              dora: fanValue(hule.fans, FAN_DORA),
              akaDora: fanValue(hule.fans, FAN_AKA_DORA),
              uraDora: fanValue(hule.fans, FAN_URA_DORA),
              nukiDora: fanValue(hule.fans, FAN_NUKI_DORA),
              ippatsu: hule.fans.some((fan) => fan.id === FAN_IPPATSU) ? 1 : 0,
              riichi: winnerRiichi ? 1 : 0,
              doubleRiichi: hule.fans.some((fan) => fan.id === FAN_DOUBLE_RIICHI) ? 1 : 0,
              winnerCalls: round.calls[hule.seat],
              winnerState: winnerRiichi ? "立直" : round.calls[hule.seat] > 0 ? "副露" : "ダマ",
              loserState: hule.zimo ? "" : loserState,
            });
            winners.set(hule.seat, { points, zimo: hule.zimo });
            if (!hule.zimo) paid += points;
          }

          if (failedRiichi) {
            failedRiichi.result = "宣言牌で放銃";
            failedRiichi.points = paid;
          }
          const anyTsumo = event.hules.some((hule) => hule.zimo);
          closeRound((riichi) => {
            if (riichi === failedRiichi) return { text: riichi.result, win: false, points: paid };
            const won = winners.get(riichi.seat);
            if (won) return { text: won.zimo ? "ツモ和了" : "ロン和了", win: true, points: won.points };
            if (riichi.seat === loser) return { text: "放銃", win: false, points: paid };
            return { text: anyTsumo ? "被ツモ" : "横移動", win: false, points: 0 };
          });
          break;
        }
        case "RecordNoTile":
          settlePendingRiichi();
          closeRound(() => ({ text: "流局", win: false, points: 0 }));
          break;
        case "RecordLiuJu":
          settlePendingRiichi();
          closeRound(() => ({ text: "途中流局", win: false, points: 0 }));
          break;
        default:
          if (!game.unknownActions.includes(action.name)) game.unknownActions.push(action.name);
      }
    }

    if (round) closeRound(() => ({ text: "不明", win: false, points: 0 }));
    return game;
  }

  MPS.analyze = { analyzeGame };
})(typeof globalThis !== "undefined" ? globalThis : this);
