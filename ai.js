// Author: Mark Daniel G. Dacer

(function (root) {
  "use strict";

  const L = root.TongitsLogic;

  const DIFFICULTY = {
    easy: {
      mistake: 0.22,
      exposeBias: 0.46,
      sapawBias: 0.55,
      drawPointLimit: 5,
      challengeLimit: 7,
      discardNoise: 8
    },
    medium: {
      mistake: 0.08,
      exposeBias: 0.68,
      sapawBias: 0.78,
      drawPointLimit: 8,
      challengeLimit: 10,
      discardNoise: 3
    },
    hard: {
      mistake: 0.02,
      exposeBias: 0.82,
      sapawBias: 0.93,
      drawPointLimit: 10,
      challengeLimit: 12,
      discardNoise: 1
    }
  };

  const PERSONALITIES = [
    {
      name: "Maya",
      style: "pressure player",
      risk: 0.72,
      expose: 0.16,
      sapaw: 0.22,
      drawCalls: 0.18
    },
    {
      name: "Lito",
      style: "patient counter",
      risk: 0.42,
      expose: -0.06,
      sapaw: 0.08,
      drawCalls: -0.04
    }
  ];

  function configFor(playerIndex, difficulty) {
    const base = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    const personality = PERSONALITIES[(playerIndex - 1 + PERSONALITIES.length) % PERSONALITIES.length];
    return {
      difficulty,
      personality,
      mistake: base.mistake,
      exposeBias: clamp01(base.exposeBias + personality.expose),
      sapawBias: clamp01(base.sapawBias + personality.sapaw),
      drawPointLimit: base.drawPointLimit + Math.round(personality.drawCalls * 6),
      challengeLimit: base.challengeLimit + Math.round(personality.risk * 3),
      discardNoise: base.discardNoise,
      risk: personality.risk
    };
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function rand(game) {
    return game.rng();
  }

  function ids(cards) {
    return cards.map((card) => card.id);
  }

  function withoutCard(cards, cardId) {
    return cards.filter((card) => card.id !== cardId);
  }

  function meldValue(meld) {
    return L.cardsPointTotal(meld.cards) + meld.cards.length * 2;
  }

  function visiblePressure(game, targetIndex) {
    const player = game.state.players[targetIndex];
    let pressure = 0;
    if (!player.opened) pressure += 8;
    pressure += Math.max(0, 8 - player.hand.length);
    pressure -= player.melds.length * 2;
    return pressure;
  }

  function estimateOpponentDeadwood(game, index) {
    const player = game.state.players[index];
    if (!player.opened) return 18 + player.hand.length * 2;
    return Math.max(4, player.hand.length * 4 - player.melds.length * 2);
  }

  function chooseBestDiscard(game, playerIndex, cfg) {
    const player = game.state.players[playerIndex];
    const currentBest = L.bestDeadwood(player.hand);
    const candidates = player.hand.map((card) => {
      const after = L.bestDeadwood(withoutCard(player.hand, card.id));
      let score = after.points * 12 - L.cardPoint(card) * 1.8;

      const inCurrentDeadwood = currentBest.deadwoodCards.some((item) => item.id === card.id);
      if (!inCurrentDeadwood) score += 14;

      for (const ref of game.getAllMeldRefs()) {
        if (ref.ownerIndex !== playerIndex && game.canLayOffCard(card, ref.meld)) {
          score += cfg.difficulty === "hard" ? 5 : 2;
        }
      }

      const neighborRanks = player.hand.filter((item) => item.suit === card.suit && Math.abs(item.rank - card.rank) <= 2).length;
      score += Math.max(0, neighborRanks - 1) * (cfg.difficulty === "easy" ? 1 : 3);
      score += (rand(game) - 0.5) * cfg.discardNoise;
      return { card, score };
    });

    candidates.sort((a, b) => a.score - b.score);
    if (rand(game) < cfg.mistake && candidates.length > 1) {
      const sloppy = candidates.slice(0, Math.min(4, candidates.length));
      return sloppy[Math.floor(rand(game) * sloppy.length)].card;
    }
    return candidates[0].card;
  }

  function chooseDiscardMeld(game, playerIndex, options, cfg) {
    const player = game.state.players[playerIndex];
    const scored = options.map((meld) => {
      const remaining = player.hand.filter((card) => !meld.cards.some((item) => item.id === card.id));
      const after = L.bestDeadwood(remaining);
      return {
        meld,
        score: after.points * 10 - meldValue(meld) - (player.opened ? 0 : 12)
      };
    });
    scored.sort((a, b) => a.score - b.score);
    if (rand(game) < cfg.mistake && scored.length > 1) {
      return scored[1].meld;
    }
    return scored[0] && scored[0].meld;
  }

  function shouldTakeDiscard(game, playerIndex, cfg) {
    const options = game.getDiscardMeldOptions(playerIndex);
    if (!options.length) return { take: false };

    const player = game.state.players[playerIndex];
    const current = L.bestDeadwood(player.hand);
    const meld = chooseDiscardMeld(game, playerIndex, options, cfg);
    const remaining = player.hand.concat([game.state.discard[game.state.discard.length - 1]])
      .filter((card) => !meld.cards.some((item) => item.id === card.id));
    const after = L.bestDeadwood(remaining);
    const improvement = current.points - after.points;
    const opensHand = !player.opened;
    const highValueMeld = meldValue(meld) >= 22;

    let threshold = cfg.difficulty === "hard" ? -2 : 1;
    if (opensHand) threshold -= 5;
    if (game.state.stock.length <= 12) threshold -= 4;
    if (highValueMeld) threshold -= 2;

    const take = improvement >= threshold || rand(game) < cfg.risk * 0.18;
    return { take, meld };
  }

  function shouldExposeMeld(game, playerIndex, meld, cfg) {
    const player = game.state.players[playerIndex];
    if (!meld) return false;
    if (!player.opened) {
      if (game.state.stock.length <= 18) return true;
      if (meldValue(meld) >= 18) return rand(game) < cfg.exposeBias + 0.12;
      return rand(game) < cfg.exposeBias;
    }
    if (cfg.difficulty === "hard") {
      const before = L.bestDeadwood(player.hand).points;
      const after = L.bestDeadwood(player.hand.filter((card) => !meld.cards.some((item) => item.id === card.id))).points;
      if (after < before) return true;
      return meldValue(meld) >= 26 && rand(game) < 0.55;
    }
    return rand(game) < cfg.exposeBias && meldValue(meld) >= 14;
  }

  function chooseOptionalMeld(game, playerIndex, cfg) {
    const player = game.state.players[playerIndex];
    const melds = game.getLegalMelds(playerIndex);
    const scored = melds.map((meld) => {
      const remaining = player.hand.filter((card) => !meld.cards.some((item) => item.id === card.id));
      const after = L.bestDeadwood(remaining);
      return { meld, score: after.points * 8 - meldValue(meld) - (player.opened ? 0 : 10) };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored[0] && scored[0].meld;
  }

  function performSapaws(game, playerIndex, cfg) {
    let didAny = false;
    let guard = 0;
    while (!game.state.roundOver && guard < 10) {
      guard += 1;
      const legal = game.getLegalSapaws(playerIndex);
      if (!legal.length) break;
      const scored = legal.map((move) => {
        const opponentBlock = move.ownerIndex !== playerIndex ? 5 + visiblePressure(game, move.ownerIndex) : -2;
        return {
          move,
          score: L.cardPoint(move.card) * 4 + opponentBlock + (rand(game) - 0.5) * 2
        };
      });
      scored.sort((a, b) => b.score - a.score);
      const chosen = scored[0].move;
      if (rand(game) > cfg.sapawBias && L.cardPoint(chosen.card) < 8) break;
      const result = game.layOff(playerIndex, chosen.card.id, chosen.ownerIndex, chosen.meldId);
      if (!result.ok) break;
      didAny = true;
    }
    return didAny;
  }

  function exposeOptionalMelds(game, playerIndex, cfg) {
    let exposed = false;
    let guard = 0;
    while (!game.state.roundOver && guard < 6) {
      guard += 1;
      const meld = chooseOptionalMeld(game, playerIndex, cfg);
      if (!shouldExposeMeld(game, playerIndex, meld, cfg)) break;
      const result = game.exposeMeld(playerIndex, ids(meld.cards));
      if (!result.ok) break;
      exposed = true;
    }
    return exposed;
  }

  function shouldCallDraw(game, playerIndex, cfg) {
    const check = game.canCallDraw(playerIndex);
    if (!check.ok) return false;
    const own = L.bestDeadwood(game.state.players[playerIndex].hand).points;
    if (cfg.difficulty === "easy") {
      return own <= cfg.drawPointLimit && rand(game) > 0.35;
    }
    const next = L.nextIndex(playerIndex);
    const other = L.nextIndex(next);
    const estimate = Math.min(estimateOpponentDeadwood(game, next), estimateOpponentDeadwood(game, other));
    const stockPressure = game.state.stock.length <= 10 ? 3 : 0;
    const confidence = estimate - own + stockPressure + cfg.risk * 2;
    return own <= cfg.drawPointLimit && confidence >= (cfg.difficulty === "hard" ? 4 : 2);
  }

  function answerDraw(game, playerIndex) {
    const player = game.state.players[playerIndex];
    const cfg = configFor(playerIndex, player.difficulty);
    if (!player.opened) return "fold";
    const own = L.bestDeadwood(player.hand).points;
    const callerIndex = game.state.pendingDraw.callerIndex;
    const callerEstimate = estimateOpponentDeadwood(game, callerIndex) - 4;
    if (cfg.difficulty === "easy") {
      if (own <= cfg.challengeLimit) return "challenge";
      return rand(game) < cfg.mistake ? "challenge" : "fold";
    }
    if (cfg.difficulty === "medium") {
      return own <= cfg.challengeLimit || own <= callerEstimate + 1 ? "challenge" : "fold";
    }
    const pressure = game.state.stock.length <= 8 ? 2 : 0;
    return own <= cfg.challengeLimit || own <= callerEstimate + pressure ? "challenge" : "fold";
  }

  function playTurn(game, playerIndex) {
    const player = game.state.players[playerIndex];
    const cfg = configFor(playerIndex, player.difficulty);

    if (game.state.phase === "dealerDiscard") {
      exposeOptionalMelds(game, playerIndex, cfg);
      if (!game.state.roundOver) performSapaws(game, playerIndex, cfg);
      if (!game.state.roundOver && game.canCallTongits(playerIndex).ok) {
        if (rand(game) < 0.92) return game.callTongits(playerIndex);
      }
      if (!game.state.roundOver) return game.discard(playerIndex, chooseBestDiscard(game, playerIndex, cfg).id);
      return { ok: true };
    }

    if (game.state.phase !== "awaitDraw") return { ok: false, error: "Bot was asked to act outside a turn start." };

    if (shouldCallDraw(game, playerIndex, cfg)) {
      return game.callDraw(playerIndex);
    }

    const discardChoice = shouldTakeDiscard(game, playerIndex, cfg);
    if (discardChoice.take && discardChoice.meld) {
      const draw = game.drawFromDiscard(playerIndex);
      if (draw.ok) game.exposeMeld(playerIndex, ids(discardChoice.meld.cards));
    } else {
      game.drawFromStock(playerIndex);
    }

    if (!game.state.roundOver) exposeOptionalMelds(game, playerIndex, cfg);
    if (!game.state.roundOver) performSapaws(game, playerIndex, cfg);
    if (!game.state.roundOver && game.canCallTongits(playerIndex).ok) {
      if (cfg.difficulty === "easy" || rand(game) > cfg.mistake) return game.callTongits(playerIndex);
    }
    if (!game.state.roundOver) return game.discard(playerIndex, chooseBestDiscard(game, playerIndex, cfg).id);
    return { ok: true };
  }

  const TongitsAI = {
    PERSONALITIES,
    DIFFICULTY,
    configFor,
    playTurn,
    answerDraw,
    estimateOpponentDeadwood
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = TongitsAI;
  }
  root.TongitsAI = TongitsAI;
})(typeof globalThis !== "undefined" ? globalThis : this);
