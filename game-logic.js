// Author: Mark Daniel G. Dacer

(function (root) {
  "use strict";

  const SUITS = ["S", "H", "D", "C"];
  const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const RANK_LABELS = {
    1: "A",
    11: "J",
    12: "Q",
    13: "K"
  };
  const SUIT_NAMES = {
    S: "Spades",
    H: "Hearts",
    D: "Diamonds",
    C: "Clubs"
  };

  const RULESET = {
    name: "Pagat-style strict-open Tongits",
    burnPenalty: 10,
    drawChallengeBonus: 5,
    tongitsBonus: 10,
    foldPayment: 5,
    notes: [
      "Three players use one 52-card deck without jokers.",
      "Dealer receives 13 cards; the other two players receive 12 cards.",
      "Aces are low only: A-2-3 is legal, Q-K-A is not.",
      "Discard pickup must immediately create and expose a new meld containing that discard.",
      "A player must expose at least one own meld to call Draw or challenge Draw.",
      "A player with no exposed own meld at round end is sunog/burned and cannot win stock-exhaustion comparison.",
      "Burned losers pay an extra app-score penalty of 10 points in this implementation."
    ]
  };

  function makeRng(seed) {
    let t = seed >>> 0;
    return function rng() {
      t += 0x6D2B79F5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: `${suit}${rank}`, suit, rank });
      }
    }
    return deck;
  }

  function cloneCard(card) {
    return { id: card.id, suit: card.suit, rank: card.rank };
  }

  function shuffle(deck, rng) {
    const cards = deck.slice();
    for (let i = cards.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  function cardLabel(card) {
    return `${RANK_LABELS[card.rank] || card.rank}${card.suit}`;
  }

  function cardPoint(card) {
    if (card.rank === 1) return 1;
    if (card.rank >= 10) return 10;
    return card.rank;
  }

  function cardsPointTotal(cards) {
    return cards.reduce((total, card) => total + cardPoint(card), 0);
  }

  function suitOrder(suit) {
    return SUITS.indexOf(suit);
  }

  function sortCards(cards) {
    return cards.slice().sort((a, b) => {
      if (a.suit !== b.suit) return suitOrder(a.suit) - suitOrder(b.suit);
      return a.rank - b.rank;
    });
  }

  function normalizeMeldCards(type, cards) {
    if (type === "run") {
      return cards.slice().sort((a, b) => a.rank - b.rank);
    }
    return cards.slice().sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return suitOrder(a.suit) - suitOrder(b.suit);
    });
  }

  function uniqueCardIds(cards) {
    return new Set(cards.map((card) => card.id)).size === cards.length;
  }

  function getMeldType(cards) {
    if (!Array.isArray(cards) || cards.length < 3 || !uniqueCardIds(cards)) {
      return null;
    }

    const sameRank = cards.every((card) => card.rank === cards[0].rank);
    if (sameRank && cards.length <= 4) return "set";

    const sameSuit = cards.every((card) => card.suit === cards[0].suit);
    if (!sameSuit) return null;

    const ranks = cards.map((card) => card.rank).sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i += 1) {
      if (ranks[i] !== ranks[i - 1] + 1) return null;
    }
    return "run";
  }

  function isValidMeld(cards) {
    return Boolean(getMeldType(cards));
  }

  function combinations(items, size) {
    const result = [];
    function walk(start, picked) {
      if (picked.length === size) {
        result.push(picked.slice());
        return;
      }
      for (let i = start; i <= items.length - (size - picked.length); i += 1) {
        picked.push(items[i]);
        walk(i + 1, picked);
        picked.pop();
      }
    }
    walk(0, []);
    return result;
  }

  function findAllMelds(cards) {
    const melds = [];
    const seen = new Set();

    for (const rank of RANKS) {
      const sameRank = cards.filter((card) => card.rank === rank);
      if (sameRank.length >= 3) {
        for (const size of [3, 4]) {
          if (sameRank.length >= size) {
            for (const combo of combinations(sameRank, size)) {
              const ids = combo.map((card) => card.id).sort().join("|");
              if (!seen.has(ids)) {
                seen.add(ids);
                melds.push({ type: "set", cards: normalizeMeldCards("set", combo) });
              }
            }
          }
        }
      }
    }

    for (const suit of SUITS) {
      const suited = cards.filter((card) => card.suit === suit).sort((a, b) => a.rank - b.rank);
      for (let start = 0; start < suited.length; start += 1) {
        for (let end = start + 2; end < suited.length; end += 1) {
          const slice = suited.slice(start, end + 1);
          if (getMeldType(slice) === "run") {
            const ids = slice.map((card) => card.id).sort().join("|");
            if (!seen.has(ids)) {
              seen.add(ids);
              melds.push({ type: "run", cards: normalizeMeldCards("run", slice) });
            }
          }
        }
      }
    }

    return melds.sort((a, b) => {
      const pointDiff = cardsPointTotal(b.cards) - cardsPointTotal(a.cards);
      if (pointDiff !== 0) return pointDiff;
      return b.cards.length - a.cards.length;
    });
  }

  function bestDeadwood(cards) {
    const hand = sortCards(cards);
    const indexById = new Map(hand.map((card, index) => [card.id, index]));
    const melds = findAllMelds(hand).map((meld) => {
      let mask = 0;
      for (const card of meld.cards) mask |= 1 << indexById.get(card.id);
      return { type: meld.type, cards: meld.cards, mask, points: cardsPointTotal(meld.cards) };
    });

    const allMask = (1 << hand.length) - 1;
    const memo = new Map();

    function solve(mask) {
      if (memo.has(mask)) return memo.get(mask);

      const deadwoodCards = [];
      for (let i = 0; i < hand.length; i += 1) {
        if (mask & (1 << i)) deadwoodCards.push(hand[i]);
      }

      let best = {
        points: cardsPointTotal(deadwoodCards),
        deadwoodCards,
        melds: []
      };

      for (const meld of melds) {
        if ((mask & meld.mask) === meld.mask) {
          const next = solve(mask ^ meld.mask);
          const candidate = {
            points: next.points,
            deadwoodCards: next.deadwoodCards,
            melds: [meld].concat(next.melds)
          };
          const candidateMeldPoints = candidate.melds.reduce((sum, item) => sum + item.points, 0);
          const bestMeldPoints = best.melds.reduce((sum, item) => sum + item.points, 0);
          if (
            candidate.points < best.points ||
            (candidate.points === best.points && candidateMeldPoints > bestMeldPoints)
          ) {
            best = candidate;
          }
        }
      }

      memo.set(mask, best);
      return best;
    }

    const solved = solve(allMask);
    return {
      points: solved.points,
      deadwoodCards: solved.deadwoodCards.slice(),
      melds: solved.melds.map((meld) => ({
        type: meld.type,
        cards: meld.cards.slice()
      }))
    };
  }

  function findMeldsWithCard(handCards, requiredCard) {
    return findAllMelds(handCards.concat([requiredCard]))
      .filter((meld) => meld.cards.some((card) => card.id === requiredCard.id))
      .filter((meld) => meld.cards.filter((card) => card.id !== requiredCard.id).length >= 2);
  }

  function removeCardsById(cards, ids) {
    const idSet = new Set(ids);
    const removed = [];
    const kept = [];
    for (const card of cards) {
      if (idSet.has(card.id)) removed.push(card);
      else kept.push(card);
    }
    return { kept, removed };
  }

  function nextIndex(index) {
    return (index + 1) % 3;
  }

  function turnDistance(from, to) {
    let distance = 0;
    let cursor = from;
    while (cursor !== to && distance < 4) {
      cursor = nextIndex(cursor);
      distance += 1;
    }
    return distance;
  }

  class TongitsGame {
    constructor(options) {
      this.options = Object.assign(
        {
          seed: Date.now(),
          humanName: "You",
          botNames: ["Maya", "Lito"],
          difficulties: ["medium", "medium"],
          playerConfigs: null
        },
        options || {}
      );
      this.rng = makeRng(this.options.seed);
      this.matchScores = [0, 0, 0];
      this.dealerIndex = 0;
      this.roundNumber = 0;
      this.eventId = 0;
      this.meldCounter = 0;
      this.log = [];
      this.newRound();
    }

    newGame(options) {
      this.options = Object.assign({}, this.options, options || {});
      this.rng = makeRng(this.options.seed || Date.now());
      this.matchScores = [0, 0, 0];
      this.dealerIndex = 0;
      this.roundNumber = 0;
      this.eventId = 0;
      this.meldCounter = 0;
      this.log = [];
      this.newRound();
    }

    playerName(index) {
      if (!this.state || !this.state.players[index]) return `Player ${index + 1}`;
      return this.state.players[index].name;
    }

    addLog(type, text, data) {
      const entry = {
        id: ++this.eventId,
        type,
        text,
        data: data || {},
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      };
      this.log.push(entry);
      if (this.log.length > 200) this.log.shift();
      if (this.state) this.state.lastEvent = entry;
      return entry;
    }

    makePlayers() {
      if (Array.isArray(this.options.playerConfigs) && this.options.playerConfigs.length === 3) {
        return this.options.playerConfigs.map((config, index) =>
          this.makePlayerFromConfig(index, config || {})
        );
      }
      return [
        this.makePlayer(0, this.options.humanName, false, "human"),
        this.makePlayer(1, this.options.botNames[0] || "Maya", true, "bot-1"),
        this.makePlayer(2, this.options.botNames[1] || "Lito", true, "bot-2")
      ];
    }

    makePlayerFromConfig(index, config) {
      return this.makePlayer(
        index,
        config.name || `Player ${index + 1}`,
        Boolean(config.isBot),
        config.id || `player-${index + 1}`,
        config.difficulty || (config.isBot ? "medium" : "human")
      );
    }

    makePlayer(index, name, isBot, id, difficulty) {
      return {
        id,
        index,
        name,
        isBot,
        hand: [],
        melds: [],
        opened: false,
        burned: false,
        score: this.matchScores[index] || 0,
        drawBlocked: false,
        drawBlockReason: "",
        drawBlockTurn: null,
        turnStartedDrawBlockTurn: null,
        turnStartedDrawBlocked: false,
        difficulty: difficulty || (index === 0 ? "human" : this.options.difficulties[index - 1] || "medium")
      };
    }

    newRound() {
      this.roundNumber += 1;
      const players = this.makePlayers();
      const deck = shuffle(createDeck(), this.rng);
      const order = [this.dealerIndex, nextIndex(this.dealerIndex), nextIndex(nextIndex(this.dealerIndex))];
      const targetCounts = [12, 12, 12];
      targetCounts[this.dealerIndex] = 13;

      let cursor = 0;
      while (players.some((player, index) => player.hand.length < targetCounts[index])) {
        const playerIndex = order[cursor % order.length];
        if (players[playerIndex].hand.length < targetCounts[playerIndex]) {
          players[playerIndex].hand.push(deck.pop());
        }
        cursor += 1;
      }
      players.forEach((player) => {
        player.hand = sortCards(player.hand);
      });

      this.state = {
        roundNumber: this.roundNumber,
        phase: "dealerDiscard",
        players,
        dealerIndex: this.dealerIndex,
        currentPlayerIndex: this.dealerIndex,
        stock: deck,
        discard: [],
        lastStockDrawIndex: null,
        stockExhaustedAfterTurn: false,
        requiredDiscardCardId: null,
        pendingDraw: null,
        roundOver: false,
        roundSummary: null,
        turnCounter: 0,
        lastEvent: null
      };

      this.addLog("shuffle", `Round ${this.roundNumber}: ${this.playerName(this.dealerIndex)} deals the cards.`, {
        dealerIndex: this.dealerIndex
      });
      this.addLog("deal", `${this.playerName(this.dealerIndex)} has 13 cards. The other players have 12.`, {
        dealerIndex: this.dealerIndex
      });
      this.beginTurn(this.dealerIndex, "dealerDiscard");
    }

    beginTurn(playerIndex, phase) {
      const player = this.state.players[playerIndex];
      this.state.currentPlayerIndex = playerIndex;
      this.state.phase = phase || "awaitDraw";
      this.state.turnCounter += 1;
      player.turnStartedDrawBlocked = player.drawBlocked;
      player.turnStartedDrawBlockTurn = player.drawBlockTurn;
      this.addLog("turn", `${player.name}'s turn${this.state.phase === "dealerDiscard" ? " to open or discard" : ""}.`, {
        playerIndex,
        phase: this.state.phase
      });
    }

    finishTurn(playerIndex) {
      const player = this.state.players[playerIndex];
      if (player.turnStartedDrawBlocked && player.drawBlockTurn === player.turnStartedDrawBlockTurn) {
        player.drawBlocked = false;
        player.drawBlockReason = "";
        player.drawBlockTurn = null;
        player.turnStartedDrawBlocked = false;
        player.turnStartedDrawBlockTurn = null;
      }
      this.state.requiredDiscardCardId = null;
      this.state.phase = "awaitDraw";
      this.beginTurn(nextIndex(playerIndex), "awaitDraw");
    }

    ok(data) {
      return Object.assign({ ok: true }, data || {});
    }

    fail(error) {
      this.addLog("invalid", error, {
        playerIndex: this.state ? this.state.currentPlayerIndex : null
      });
      return { ok: false, error };
    }

    ensureActivePlayer(playerIndex) {
      if (this.state.roundOver) return "The round is already over.";
      if (this.state.pendingDraw) return "A Draw call is waiting for folds or challenges.";
      if (this.state.currentPlayerIndex !== playerIndex) return `It is ${this.playerName(this.state.currentPlayerIndex)}'s turn.`;
      return "";
    }

    getPlayer(playerIndex) {
      return this.state.players[playerIndex];
    }

    getLegalMelds(playerIndex) {
      return findAllMelds(this.getPlayer(playerIndex).hand);
    }

    getDiscardMeldOptions(playerIndex) {
      if (!this.state.discard.length) return [];
      return findMeldsWithCard(this.getPlayer(playerIndex).hand, this.state.discard[this.state.discard.length - 1]);
    }

    drawFromStock(playerIndex) {
      const activeError = this.ensureActivePlayer(playerIndex);
      if (activeError) return this.fail(activeError);
      if (this.state.phase !== "awaitDraw") return this.fail("You can draw from stock only at the start of your turn.");
      if (!this.state.stock.length) return this.fail("The stock is empty.");

      const card = this.state.stock.pop();
      const player = this.getPlayer(playerIndex);
      player.hand.push(card);
      player.hand = sortCards(player.hand);
      this.state.lastStockDrawIndex = playerIndex;
      this.state.phase = "afterDraw";
      if (this.state.stock.length === 0) this.state.stockExhaustedAfterTurn = true;
      this.addLog("draw", `${player.name} draws from the stock.`, {
        playerIndex,
        source: "stock",
        card: cloneCard(card)
      });
      return this.ok({ card });
    }

    drawFromDiscard(playerIndex) {
      const activeError = this.ensureActivePlayer(playerIndex);
      if (activeError) return this.fail(activeError);
      if (this.state.phase !== "awaitDraw") return this.fail("You can take the discard only at the start of your turn.");
      if (!this.state.discard.length) return this.fail("The discard pile is empty.");

      const options = this.getDiscardMeldOptions(playerIndex);
      if (!options.length) {
        return this.fail("You may take the discard only if it immediately forms a new meld with at least two cards from your hand.");
      }

      const card = this.state.discard.pop();
      const player = this.getPlayer(playerIndex);
      player.hand.push(card);
      player.hand = sortCards(player.hand);
      this.state.requiredDiscardCardId = card.id;
      this.state.phase = "mustMeldDiscard";
      this.addLog("draw", `${player.name} takes ${cardLabel(card)} from the discard pile and must expose a meld with it.`, {
        playerIndex,
        source: "discard",
        card: cloneCard(card)
      });
      return this.ok({ card, options });
    }

    exposeMeld(playerIndex, cardIds) {
      const activeError = this.ensureActivePlayer(playerIndex);
      if (activeError) return this.fail(activeError);
      if (!["afterDraw", "dealerDiscard", "mustMeldDiscard"].includes(this.state.phase)) {
        return this.fail("You can expose a meld only after drawing, or during the dealer's opening discard turn.");
      }
      if (!Array.isArray(cardIds) || cardIds.length < 3) return this.fail("Select at least three cards for a meld.");

      const player = this.getPlayer(playerIndex);
      const idSet = new Set(cardIds);
      if (idSet.size !== cardIds.length) return this.fail("A meld cannot use the same card twice.");

      const selected = player.hand.filter((card) => idSet.has(card.id));
      if (selected.length !== cardIds.length) return this.fail("Every meld card must be in your hand.");

      const type = getMeldType(selected);
      if (!type) return this.fail("That is not a legal Tongits meld. Use a set of 3-4 same-rank cards or a same-suit run of 3+ cards.");

      if (this.state.phase === "mustMeldDiscard" && !idSet.has(this.state.requiredDiscardCardId)) {
        return this.fail("The exposed meld must include the discard you just picked up.");
      }

      const removed = removeCardsById(player.hand, cardIds);
      player.hand = sortCards(removed.kept);
      const normalized = normalizeMeldCards(type, selected);
      const meld = {
        id: `m${++this.meldCounter}`,
        ownerIndex: playerIndex,
        type,
        cards: normalized,
        createdTurn: this.state.turnCounter,
        sapawHistory: []
      };
      player.melds.push(meld);
      player.opened = true;
      if (this.state.phase === "mustMeldDiscard") {
        this.state.requiredDiscardCardId = null;
        this.state.phase = "afterDraw";
      }
      this.addLog("meld", `${player.name} exposes a ${type}: ${normalized.map(cardLabel).join(" ")}.`, {
        playerIndex,
        meldId: meld.id,
        meldType: type,
        cards: normalized.map(cloneCard)
      });

      if (player.hand.length === 0) this.resolveTongits(playerIndex, "melded every remaining card");
      return this.ok({ meld });
    }

    canLayOffCard(card, meld) {
      if (!card || !meld) return false;
      if (meld.type === "set" && meld.cards.length >= 4) return false;
      const testCards = meld.cards.concat([card]);
      return getMeldType(testCards) === meld.type;
    }

    getAllMeldRefs() {
      const refs = [];
      for (const owner of this.state.players) {
        for (const meld of owner.melds) {
          refs.push({ ownerIndex: owner.index, ownerName: owner.name, meld });
        }
      }
      return refs;
    }

    getLegalSapaws(playerIndex) {
      const player = this.getPlayer(playerIndex);
      const legal = [];
      for (const card of player.hand) {
        for (const ref of this.getAllMeldRefs()) {
          if (this.canLayOffCard(card, ref.meld)) {
            legal.push({ card, ownerIndex: ref.ownerIndex, meldId: ref.meld.id, meld: ref.meld });
          }
        }
      }
      return legal;
    }

    layOff(playerIndex, cardId, ownerIndex, meldId) {
      const activeError = this.ensureActivePlayer(playerIndex);
      if (activeError) return this.fail(activeError);
      if (!["afterDraw", "dealerDiscard"].includes(this.state.phase)) {
        return this.fail("Sapaw is allowed only after drawing, before you discard.");
      }

      const player = this.getPlayer(playerIndex);
      const card = player.hand.find((item) => item.id === cardId);
      if (!card) return this.fail("That sapaw card is not in your hand.");
      const owner = this.getPlayer(ownerIndex);
      const meld = owner.melds.find((item) => item.id === meldId);
      if (!meld) return this.fail("That exposed meld no longer exists.");
      if (!this.canLayOffCard(card, meld)) return this.fail(`${cardLabel(card)} cannot be legally added to that meld.`);

      player.hand = player.hand.filter((item) => item.id !== cardId);
      meld.cards = normalizeMeldCards(meld.type, meld.cards.concat([card]));
      meld.sapawHistory.push({ playerIndex, card: cloneCard(card), turn: this.state.turnCounter });

      owner.drawBlocked = true;
      owner.drawBlockTurn = this.state.turnCounter;
      owner.drawBlockReason =
        ownerIndex === playerIndex
          ? "You sapawed your own meld on your previous turn."
          : `${player.name} sapawed one of your melds.`;

      this.addLog(
        "sapaw",
        `${player.name} sapaws ${cardLabel(card)} onto ${owner.name}'s ${meld.type}. ${owner.name} is blocked from calling Draw on their next turn.`,
        {
          playerIndex,
          ownerIndex,
          meldId,
          card: cloneCard(card)
        }
      );

      if (player.hand.length === 0) this.resolveTongits(playerIndex, "used the last card by sapaw");
      return this.ok({ card, meld });
    }

    discard(playerIndex, cardId) {
      const activeError = this.ensureActivePlayer(playerIndex);
      if (activeError) return this.fail(activeError);
      if (!["afterDraw", "dealerDiscard"].includes(this.state.phase)) {
        if (this.state.phase === "mustMeldDiscard") {
          return this.fail("You must expose a meld containing the discard you picked up before discarding.");
        }
        return this.fail("You must draw before discarding.");
      }

      const player = this.getPlayer(playerIndex);
      const card = player.hand.find((item) => item.id === cardId);
      if (!card) return this.fail("That discard card is not in your hand.");

      player.hand = player.hand.filter((item) => item.id !== cardId);
      this.state.discard.push(card);
      this.addLog("discard", `${player.name} discards ${cardLabel(card)}.`, {
        playerIndex,
        card: cloneCard(card)
      });

      if (player.hand.length === 0) {
        this.resolveTongits(playerIndex, "discarded their last card");
        return this.ok({ card, ended: true });
      }

      if (this.state.stockExhaustedAfterTurn) {
        this.resolveStockExhaustion(playerIndex);
        return this.ok({ card, ended: true });
      }

      this.finishTurn(playerIndex);
      return this.ok({ card });
    }

    canCallTongits(playerIndex) {
      if (this.state.roundOver || this.state.pendingDraw) return { ok: false, reason: "The round is not in a playable state." };
      if (this.state.currentPlayerIndex !== playerIndex) return { ok: false, reason: "You can call Tongits only on your turn." };
      if (!["afterDraw", "dealerDiscard"].includes(this.state.phase)) {
        return { ok: false, reason: "Call Tongits after drawing, melding, sapaw, or on the dealer opening turn." };
      }
      const player = this.getPlayer(playerIndex);
      if (player.hand.length === 0) return { ok: true };
      const deadwood = bestDeadwood(player.hand);
      if (deadwood.points === 0) return { ok: true };
      return { ok: false, reason: `You still have ${deadwood.points} deadwood points.` };
    }

    callTongits(playerIndex) {
      const check = this.canCallTongits(playerIndex);
      if (!check.ok) return this.fail(check.reason);
      this.resolveTongits(playerIndex, "all remaining hand cards are in legal melds or already laid off");
      return this.ok({ ended: true });
    }

    canCallDraw(playerIndex) {
      if (this.state.roundOver || this.state.pendingDraw) return { ok: false, reason: "The round is not ready for a Draw call." };
      if (this.state.currentPlayerIndex !== playerIndex) return { ok: false, reason: "You can call Draw only at the start of your own turn." };
      if (this.state.phase !== "awaitDraw") return { ok: false, reason: "Draw must be called before you draw a card." };
      const player = this.getPlayer(playerIndex);
      if (!player.opened) return { ok: false, reason: "You must expose at least one meld before you can call Draw." };
      if (player.drawBlocked) return { ok: false, reason: player.drawBlockReason || "A recent sapaw blocks your Draw call this turn." };
      return { ok: true };
    }

    callDraw(playerIndex) {
      const check = this.canCallDraw(playerIndex);
      if (!check.ok) return this.fail(check.reason);

      const order = [nextIndex(playerIndex), nextIndex(nextIndex(playerIndex))];
      this.state.pendingDraw = {
        callerIndex: playerIndex,
        responderOrder: order,
        position: 0,
        responses: {},
        folded: [],
        challengers: []
      };
      this.state.phase = "drawResponses";
      this.addLog("draw-call", `${this.playerName(playerIndex)} calls Draw. Opened opponents may fold or challenge.`, {
        callerIndex: playerIndex
      });
      this.advanceDrawResponses();
      return this.ok({ pendingDraw: this.state.pendingDraw });
    }

    getCurrentDrawResponder() {
      const pending = this.state.pendingDraw;
      if (!pending) return null;
      if (pending.position >= pending.responderOrder.length) return null;
      return pending.responderOrder[pending.position];
    }

    advanceDrawResponses() {
      const pending = this.state.pendingDraw;
      if (!pending) return;

      while (pending.position < pending.responderOrder.length) {
        const responderIndex = pending.responderOrder[pending.position];
        const responder = this.getPlayer(responderIndex);
        if (responder.opened) break;
        pending.responses[responderIndex] = "auto-fold";
        pending.folded.push(responderIndex);
        this.addLog("fold", `${responder.name} has no exposed meld and automatically folds. They are at risk of sunog.`, {
          playerIndex: responderIndex,
          automatic: true
        });
        pending.position += 1;
      }

      if (pending.position >= pending.responderOrder.length) this.resolveDraw();
    }

    respondToDraw(playerIndex, response) {
      if (!this.state.pendingDraw) return this.fail("There is no Draw call to answer.");
      const currentResponder = this.getCurrentDrawResponder();
      if (currentResponder !== playerIndex) return this.fail(`It is ${this.playerName(currentResponder)}'s response.`);
      if (!["fold", "challenge"].includes(response)) return this.fail("Choose Fold or Challenge.");

      const pending = this.state.pendingDraw;
      const player = this.getPlayer(playerIndex);
      if (response === "challenge") {
        if (!player.opened) return this.fail("Only players with an exposed meld can challenge Draw.");
        pending.responses[playerIndex] = "challenge";
        pending.challengers.push(playerIndex);
        this.addLog("challenge", `${player.name} challenges the Draw.`, {
          playerIndex
        });
      } else {
        pending.responses[playerIndex] = "fold";
        pending.folded.push(playerIndex);
        this.addLog("fold", `${player.name} folds to the Draw call.`, {
          playerIndex
        });
      }
      pending.position += 1;
      this.advanceDrawResponses();
      return this.ok({ pendingDraw: this.state.pendingDraw });
    }

    resolveDraw() {
      const pending = this.state.pendingDraw;
      if (!pending) return;

      const callerIndex = pending.callerIndex;
      const participants = [callerIndex].concat(pending.challengers);
      const deadwood = this.computeAllDeadwood();
      let winnerIndex = callerIndex;

      if (pending.challengers.length) {
        const minPoints = Math.min.apply(null, participants.map((index) => deadwood[index].points));
        const tied = participants.filter((index) => deadwood[index].points === minPoints);
        const tiedChallengers = tied.filter((index) => index !== callerIndex);
        if (tiedChallengers.length) {
          tiedChallengers.sort((a, b) => turnDistance(callerIndex, a) - turnDistance(callerIndex, b));
          winnerIndex = tiedChallengers[0];
        } else {
          winnerIndex = tied[0];
        }
      }

      this.applyBurns(winnerIndex);
      const detail = pending.challengers.length
        ? "Draw was challenged; lowest deadwood wins, and challengers win ties against the caller."
        : "Both opponents folded or were not eligible to challenge.";
      this.endRound("draw", winnerIndex, {
        detail,
        participants,
        folded: pending.folded.slice(),
        challengers: pending.challengers.slice(),
        callerIndex
      });
    }

    computeAllDeadwood() {
      return this.state.players.map((player) => bestDeadwood(player.hand));
    }

    applyBurns(winnerIndex) {
      for (const player of this.state.players) {
        player.burned = player.index !== winnerIndex && !player.opened;
        if (player.burned) {
          this.addLog("burn", `${player.name} is sunog/burned: no exposed own meld at round end.`, {
            playerIndex: player.index
          });
        }
      }
    }

    resolveTongits(playerIndex, detail) {
      this.applyBurns(playerIndex);
      this.endRound("tongits", playerIndex, {
        detail: `${this.playerName(playerIndex)} wins by Tongits: ${detail}.`,
        participants: [playerIndex],
        folded: [],
        challengers: []
      });
    }

    resolveStockExhaustion(lastDrawerIndex) {
      const deadwood = this.computeAllDeadwood();
      const eligible = this.state.players.filter((player) => player.opened).map((player) => player.index);

      if (!eligible.length) {
        for (const player of this.state.players) {
          player.burned = true;
          this.addLog("burn", `${player.name} is sunog/burned: nobody exposed a meld before the stock ran out.`, {
            playerIndex: player.index
          });
        }
        this.endRound("stock", null, {
          detail: "The stock ran out, but every player was sunog. No low-point winner is awarded.",
          participants: [],
          folded: [],
          challengers: [],
          lastDrawerIndex
        });
        return;
      }

      const minPoints = Math.min.apply(null, eligible.map((index) => deadwood[index].points));
      const tied = eligible.filter((index) => deadwood[index].points === minPoints);
      let winnerIndex = tied[0];
      if (tied.length > 1) {
        if (tied.includes(lastDrawerIndex)) {
          winnerIndex = lastDrawerIndex;
        } else {
          const nextPlayer = nextIndex(lastDrawerIndex);
          winnerIndex = tied.includes(nextPlayer) ? nextPlayer : tied[0];
        }
      }

      this.applyBurns(winnerIndex);
      this.endRound("stock", winnerIndex, {
        detail: "The stock ran out after the last drawer completed their turn. Only opened players can win the low-point comparison.",
        participants: eligible,
        folded: [],
        challengers: [],
        lastDrawerIndex
      });
    }

    endRound(reason, winnerIndex, extra) {
      const deadwood = this.computeAllDeadwood();
      const summary = this.buildRoundSummary(reason, winnerIndex, deadwood, extra || {});
      this.state.roundOver = true;
      this.state.phase = "roundOver";
      this.state.pendingDraw = null;
      this.state.roundSummary = summary;
      this.state.stockExhaustedAfterTurn = false;

      if (winnerIndex === null || winnerIndex === undefined) {
        this.addLog("round-end", "Round ends with no eligible winner.", {
          reason
        });
      } else {
        this.dealerIndex = winnerIndex;
        this.addLog("win", `${this.playerName(winnerIndex)} wins the round by ${summary.reasonLabel}.`, {
          winnerIndex,
          reason
        });
      }
    }

    buildRoundSummary(reason, winnerIndex, deadwood, extra) {
      const reasonLabels = {
        tongits: "Tongits",
        draw: "Draw",
        stock: "stock exhaustion"
      };
      const payments = [0, 0, 0];
      const details = [];
      const folded = new Set(extra.folded || []);
      const challengedDraw = reason === "draw" && (extra.challengers || []).length > 0;

      if (winnerIndex !== null && winnerIndex !== undefined) {
        for (const player of this.state.players) {
          if (player.index === winnerIndex) continue;
          let payment;
          if (reason === "draw" && folded.has(player.index)) {
            payment = RULESET.foldPayment;
            details.push(`${player.name} folded: ${RULESET.foldPayment} points.`);
          } else {
            payment = Math.max(1, deadwood[player.index].points - deadwood[winnerIndex].points);
            details.push(`${player.name} deadwood payment: ${payment} point${payment === 1 ? "" : "s"}.`);
          }

          if (reason === "tongits") {
            payment += RULESET.tongitsBonus;
            details.push(`${player.name} pays Tongits bonus: +${RULESET.tongitsBonus}.`);
          }
          if (challengedDraw) {
            payment += RULESET.drawChallengeBonus;
            details.push(`${player.name} pays challenged Draw bonus: +${RULESET.drawChallengeBonus}.`);
          }
          if (player.burned) {
            payment += RULESET.burnPenalty;
            details.push(`${player.name} is sunog: +${RULESET.burnPenalty} burn penalty.`);
          }

          payments[player.index] -= payment;
          payments[winnerIndex] += payment;
        }
      }

      for (let i = 0; i < payments.length; i += 1) {
        this.matchScores[i] += payments[i];
        this.state.players[i].score = this.matchScores[i];
      }

      return {
        roundNumber: this.roundNumber,
        reason,
        reasonLabel: reasonLabels[reason] || reason,
        winnerIndex,
        winnerName: winnerIndex === null || winnerIndex === undefined ? "No eligible winner" : this.playerName(winnerIndex),
        deadwood: deadwood.map((item) => ({
          points: item.points,
          deadwoodCards: item.deadwoodCards.map(cloneCard),
          coveredMelds: item.melds.map((meld) => ({
            type: meld.type,
            cards: meld.cards.map(cloneCard)
          }))
        })),
        burned: this.state.players.map((player) => player.burned),
        opened: this.state.players.map((player) => player.opened),
        payments,
        detail: extra.detail || "",
        details,
        folded: extra.folded || [],
        challengers: extra.challengers || [],
        callerIndex: extra.callerIndex,
        lastDrawerIndex: extra.lastDrawerIndex
      };
    }
  }

  const TongitsLogic = {
    RULESET,
    SUITS,
    RANKS,
    SUIT_NAMES,
    cardLabel,
    cardPoint,
    cardsPointTotal,
    sortCards,
    getMeldType,
    isValidMeld,
    findAllMelds,
    findMeldsWithCard,
    bestDeadwood,
    nextIndex,
    turnDistance,
    TongitsGame
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = TongitsLogic;
  }
  root.TongitsLogic = TongitsLogic;
})(typeof globalThis !== "undefined" ? globalThis : this);
