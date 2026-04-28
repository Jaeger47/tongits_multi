// Author: Mark Daniel G. Dacer

(function () {
  "use strict";

  const L = window.TongitsLogic;

  const els = {};
  let socket = null;
  let socketUrl = "";
  let roomInfo = createEmptyRoomInfo();
  let game = null;
  let selected = new Set();
  let handGroupingEnabled = false;
  let feedbackTimer = null;
  let connectionText = "Disconnected from server.";
  let lastHandledEventId = 0;
  let resumeAttempted = false;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.enabled = false;
    }

    unlock() {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.ctx = new AudioContext();
      }
      this.enabled = true;
      if (this.ctx.state === "suspended") this.ctx.resume();
    }

    tone(freq, duration, type, gainValue) {
      if (!this.enabled || !this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainValue || 0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    }

    noise(duration, gainValue) {
      if (!this.enabled || !this.ctx) return;
      const sampleRate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, sampleRate * duration, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(gainValue || 0.05, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(this.ctx.destination);
      source.start();
      source.stop(this.ctx.currentTime + duration);
    }

    play(type) {
      if (!this.enabled || !this.ctx) return;
      if (type === "shuffle") this.noise(0.28, 0.035);
      else if (type === "deal") this.tone(420, 0.08, "triangle", 0.045);
      else if (type === "draw") this.tone(520, 0.08, "sine", 0.045);
      else if (type === "discard") this.tone(180, 0.07, "square", 0.035);
      else if (type === "meld" || type === "sapaw") {
        this.tone(560, 0.09, "triangle", 0.04);
        setTimeout(() => this.tone(760, 0.08, "triangle", 0.035), 70);
      } else if (type === "win") {
        this.tone(520, 0.12, "triangle", 0.045);
        setTimeout(() => this.tone(660, 0.14, "triangle", 0.045), 90);
        setTimeout(() => this.tone(880, 0.18, "triangle", 0.045), 190);
      } else if (type === "burn" || type === "invalid") {
        this.tone(120, 0.16, "sawtooth", 0.035);
      } else if (type === "fold" || type === "challenge" || type === "draw-call") {
        this.tone(320, 0.08, "triangle", 0.04);
      }
    }
  }

  const audio = new AudioEngine();

  function createEmptyRoomInfo() {
    return {
      code: "",
      started: false,
      paused: false,
      pauseReason: "",
      mySeatIndex: null,
      hostSeatIndex: null,
      isHost: false,
      canStart: false,
      seats: [
        { index: 0, name: "Open seat 1", connected: false, occupied: false },
        { index: 1, name: "Open seat 2", connected: false, occupied: false },
        { index: 2, name: "Open seat 3", connected: false, occupied: false }
      ]
    };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "player-name-input",
      "server-url-input",
      "room-code-input",
      "create-room-btn",
      "join-room-btn",
      "leave-room-btn",
      "card-theme-select",
      "rules-btn",
      "close-rules-btn",
      "rules-panel",
      "summary-panel",
      "summary-title",
      "summary-content",
      "next-round-btn",
      "lobby-panel",
      "lobby-title",
      "lobby-copy",
      "lobby-room-code",
      "lobby-seat-label",
      "lobby-host-label",
      "lobby-seats",
      "copy-room-btn",
      "start-match-btn",
      "connection-status",
      "room-status",
      "stock-pile",
      "discard-pile",
      "stock-count",
      "discard-label",
      "turn-banner",
      "meld-board",
      "score-strip",
      "player-0",
      "player-1",
      "player-2",
      "draw-stock-btn",
      "take-discard-btn",
      "lay-meld-btn",
      "discard-btn",
      "tongits-btn",
      "draw-call-btn",
      "sort-hand-btn",
      "auto-group-btn",
      "draw-response",
      "draw-response-title",
      "draw-response-copy",
      "challenge-btn",
      "fold-btn",
      "game-log",
      "selected-readout",
      "feedback"
    ].forEach((id) => {
      els[id] = $(id);
    });
  }

  function applyCardTheme() {
    document.body.dataset.cardTheme = els["card-theme-select"].value;
    localStorage.setItem("tongitsCardTheme", els["card-theme-select"].value);
  }

  function playerToken() {
    let token = sessionStorage.getItem("tongitsPlayerToken");
    if (!token) {
      token = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : `tok-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem("tongitsPlayerToken", token);
    }
    return token;
  }

  function playerName() {
    return String(els["player-name-input"].value || "").trim().slice(0, 24) || "Player";
  }

  function normalizedRoomCode() {
    return String(els["room-code-input"].value || "").trim().toUpperCase().slice(0, 6);
  }

  function configuredServerUrl() {
    return String(els["server-url-input"].value || "").trim();
  }

  function defaultServerUrl() {
    return String((window.TONGITS_CONFIG && window.TONGITS_CONFIG.serverUrl) || "").trim();
  }

  function saveClientPrefs() {
    localStorage.setItem("tongitsPlayerName", els["player-name-input"].value.trim());
    localStorage.setItem("tongitsServerUrl", configuredServerUrl());
    localStorage.setItem("tongitsRoomCode", normalizedRoomCode());
  }

  function clearSavedRoom() {
    localStorage.removeItem("tongitsRoomCode");
  }

  function initFormDefaults() {
    els["player-name-input"].value = localStorage.getItem("tongitsPlayerName") || "Player";
    els["server-url-input"].value = localStorage.getItem("tongitsServerUrl") || defaultServerUrl();
    els["room-code-input"].value = localStorage.getItem("tongitsRoomCode") || "";
    els["card-theme-select"].value = localStorage.getItem("tongitsCardTheme") || "classic";
    applyCardTheme();
  }

  function setFeedback(message) {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    els.feedback.textContent = message || "";
    if (message) {
      feedbackTimer = setTimeout(() => {
        els.feedback.textContent = "";
      }, 4200);
    }
  }

  function suitEntity(suit) {
    return {
      S: "&spades;",
      H: "&hearts;",
      D: "&diams;",
      C: "&clubs;"
    }[suit];
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderCard(card, opts) {
    const options = opts || {};
    if (options.back) {
      return `<div class="card back ${options.small ? "small" : ""}" aria-label="Card back"></div>`;
    }
    const red = card.suit === "H" || card.suit === "D";
    const classes = [
      "card",
      options.small ? "small" : "",
      red ? "red" : "",
      selected.has(card.id) ? "selected" : ""
    ]
      .filter(Boolean)
      .join(" ");
    const attrs = [
      `data-card-id="${card.id}"`,
      options.selectable ? 'role="button" tabindex="0"' : "",
      options.draggable ? 'draggable="true"' : ""
    ]
      .filter(Boolean)
      .join(" ");
    const rank = L.cardLabel(card).replace(card.suit, "");
    return `<div class="${classes}" ${attrs} aria-label="${escapeHtml(L.cardLabel(card))}">
      <div class="card-rank">${rank}</div>
      <div class="card-suit">${suitEntity(card.suit)}</div>
      <div class="card-corner">${rank}</div>
    </div>`;
  }

  function seatOrder() {
    if (roomInfo.mySeatIndex === null || roomInfo.mySeatIndex === undefined) return [0, 1, 2];
    return [
      roomInfo.mySeatIndex,
      L.nextIndex(roomInfo.mySeatIndex),
      L.nextIndex(L.nextIndex(roomInfo.mySeatIndex))
    ];
  }

  function seatToSlot(seatIndex) {
    return seatOrder().indexOf(seatIndex);
  }

  function slotToSeat(slot) {
    return seatOrder()[slot];
  }

  function playerPanel(seatIndex) {
    const slot = seatToSlot(seatIndex);
    return els[`player-${slot < 0 ? 0 : slot}`];
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function cardElement(cardId) {
    if (!cardId) return null;
    return document.querySelector(`.card[data-card-id="${cssEscape(cardId)}"]`);
  }

  function meldElement(meldId) {
    if (!meldId) return null;
    return document.querySelector(`.meld-group[data-meld-id="${cssEscape(meldId)}"]`);
  }

  function currentDrawResponder(state) {
    if (!state || !state.pendingDraw) return null;
    const pending = state.pendingDraw;
    if (pending.position >= pending.responderOrder.length) return null;
    return pending.responderOrder[pending.position];
  }

  function canLayOffCard(card, meld) {
    if (!card || !meld) return false;
    if (meld.type === "set" && meld.cards.length >= 4) return false;
    return L.getMeldType(meld.cards.concat([card])) === meld.type;
  }

  function wrapGame(gamePayload) {
    const wrapped = {
      state: gamePayload.state,
      log: gamePayload.log || [],
      getCurrentDrawResponder() {
        return currentDrawResponder(this.state);
      },
      getLegalMelds(playerIndex) {
        const player = this.state.players[playerIndex];
        return player ? L.findAllMelds(player.hand.filter(Boolean)) : [];
      },
      getDiscardMeldOptions(playerIndex) {
        if (!this.state.discard.length) return [];
        const topDiscard = this.state.discard[this.state.discard.length - 1];
        const player = this.state.players[playerIndex];
        return player ? L.findMeldsWithCard(player.hand.filter(Boolean), topDiscard) : [];
      },
      canCallDraw(playerIndex) {
        if (this.state.roundOver || this.state.pendingDraw) return { ok: false, reason: "The round is not ready for a Draw call." };
        if (this.state.currentPlayerIndex !== playerIndex) return { ok: false, reason: "You can call Draw only at the start of your own turn." };
        if (this.state.phase !== "awaitDraw") return { ok: false, reason: "Draw must be called before you draw a card." };
        const player = this.state.players[playerIndex];
        if (!player.opened) return { ok: false, reason: "You must expose at least one meld before you can call Draw." };
        if (player.drawBlocked) return { ok: false, reason: player.drawBlockReason || "A recent sapaw blocks your Draw call this turn." };
        return { ok: true };
      },
      canCallTongits(playerIndex) {
        if (this.state.roundOver || this.state.pendingDraw) return { ok: false, reason: "The round is not in a playable state." };
        if (this.state.currentPlayerIndex !== playerIndex) return { ok: false, reason: "You can call Tongits only on your turn." };
        if (!["afterDraw", "dealerDiscard"].includes(this.state.phase)) {
          return { ok: false, reason: "Call Tongits after drawing, melding, sapaw, or on the dealer opening turn." };
        }
        const player = this.state.players[playerIndex];
        if (player.hand.length === 0) return { ok: true };
        const deadwood = L.bestDeadwood(player.hand.filter(Boolean));
        return deadwood.points === 0
          ? { ok: true }
          : { ok: false, reason: `You still have ${deadwood.points} deadwood points.` };
      },
      canLayOffCard
    };
    return wrapped;
  }

  function selectedCards() {
    if (!game || roomInfo.mySeatIndex === null || roomInfo.mySeatIndex === undefined) return [];
    const player = game.state.players[roomInfo.mySeatIndex];
    return player ? player.hand.filter((card) => card && selected.has(card.id)) : [];
  }

  function myPlayer() {
    if (!game || roomInfo.mySeatIndex === null || roomInfo.mySeatIndex === undefined) return null;
    return game.state.players[roomInfo.mySeatIndex] || null;
  }

  function currentPlayerCanAct() {
    return Boolean(
      game &&
      !roomInfo.paused &&
      !game.state.roundOver &&
      roomInfo.mySeatIndex !== null &&
      game.state.currentPlayerIndex === roomInfo.mySeatIndex
    );
  }

  function getHiddenHandGroups(player) {
    const best = L.bestDeadwood(player.hand.filter(Boolean));
    const used = new Set();
    const groups = best.melds.map((meld) => {
      meld.cards.forEach((card) => used.add(card.id));
      return {
        type: meld.type,
        cards: meld.cards
      };
    });

    const deadwood = player.hand.filter((card) => card && !used.has(card.id));
    if (deadwood.length) {
      groups.push({
        type: "deadwood",
        cards: L.sortCards(deadwood)
      });
    }
    return groups;
  }

  function getRequiredDiscardMeldGroups(player) {
    const requiredId = game && game.state.requiredDiscardCardId;
    if (!requiredId || roomInfo.mySeatIndex === null) return [];
    return game
      .getLegalMelds(roomInfo.mySeatIndex)
      .filter((meld) => meld.cards.some((card) => card.id === requiredId))
      .filter((meld) => meld.cards.filter((card) => card.id !== requiredId).length >= 2);
  }

  function renderHiddenGroup(group, index) {
    const title = group.type === "deadwood" ? "Deadwood" : `Hidden ${group.type}`;
    const points = L.cardsPointTotal(group.cards);
    const selectable = group.type !== "deadwood" && group.cards.length >= 3;
    const selectButton = selectable
      ? `<button class="mini-action hidden-group-select" type="button" data-group-index="${index}">Select</button>`
      : "";
    return `<section class="hidden-hand-group ${group.type}" data-group-index="${index}">
      <div class="hidden-group-title">
        <span>${escapeHtml(title)} - ${group.cards.length} card${group.cards.length === 1 ? "" : "s"} - ${points} pts</span>
        ${selectButton}
      </div>
      <div class="card-row">${group.cards.map((card) => renderCard(card, { selectable: true, draggable: true })).join("")}</div>
    </section>`;
  }

  function renderRequiredDiscardMelds(player) {
    const groups = getRequiredDiscardMeldGroups(player);
    const requiredCard = player.hand.find((card) => card && card.id === game.state.requiredDiscardCardId);
    const requiredLabel = requiredCard ? L.cardLabel(requiredCard) : "the picked discard";
    const groupHtml = groups.length
      ? groups
          .map((meld, index) => `<section class="hidden-hand-group forced-discard ${meld.type}" data-required-group-index="${index}">
            <div class="hidden-group-title">
              <span>Required house - ${meld.type} - ${meld.cards.length} cards</span>
              <button class="mini-action required-meld-btn" type="button" data-group-index="${index}">Meld to Field</button>
            </div>
            <div class="card-row">${meld.cards.map((card) => renderCard(card, { selectable: true, draggable: true })).join("")}</div>
          </section>`)
          .join("")
      : `<p class="feedback">No legal required house found. The server should block this state.</p>`;

    return `<div class="hidden-hand-layout required-discard-layout">
      <div class="hidden-hand-note required">You took ${escapeHtml(requiredLabel)} from discard. Tongits rules require this card to make a new house and be exposed on the field now. It cannot stay hidden in hand.</div>
      <div class="hidden-hand-groups">${groupHtml}</div>
    </div>`;
  }

  function renderHumanHand(player) {
    if (!game) return `<div class="card-row hand-row"></div>`;
    if (game.state.phase === "mustMeldDiscard" && game.state.requiredDiscardCardId && roomInfo.mySeatIndex === game.state.currentPlayerIndex) {
      return renderRequiredDiscardMelds(player);
    }
    if (!handGroupingEnabled) {
      return `<div class="card-row hand-row">${player.hand.map((card) => renderCard(card, { selectable: true, draggable: true })).join("")}</div>`;
    }

    const groups = getHiddenHandGroups(player);
    const hiddenCount = groups.filter((group) => group.type !== "deadwood").length;
    const deadwood = L.bestDeadwood(player.hand.filter(Boolean)).points;
    return `<div class="hidden-hand-layout">
      <div class="hidden-hand-note">Private hand grouping: ${hiddenCount} hidden meld${hiddenCount === 1 ? "" : "s"}, ${deadwood} deadwood points. Lay a meld to expose it and avoid sunog.</div>
      <div class="hidden-hand-groups">${groups.map(renderHiddenGroup).join("")}</div>
    </div>`;
  }

  function renderMultiplayerStatus() {
    const roomText = roomInfo.code
      ? `Room ${roomInfo.code} - ${roomInfo.started ? (roomInfo.paused ? "paused" : "in match") : "in lobby"}`
      : "Not in a room yet.";
    els["connection-status"].textContent = connectionText;
    els["room-status"].textContent = roomText;
  }

  function renderScoreStrip() {
    if (!game) {
      els["score-strip"].innerHTML = "";
      return;
    }
    els["score-strip"].innerHTML = game.state.players
      .map((player) => `<span class="score-chip">${escapeHtml(player.name)}: ${player.score}</span>`)
      .join("");
  }

  function renderPlayerSlot(slot) {
    const seatIndex = slotToSeat(slot);
    const panel = els[`player-${slot}`];
    const seat = roomInfo.seats[seatIndex];

    if (!game) {
      const seatTitle = seat && seat.occupied ? seat.name : `Open seat ${seatIndex + 1}`;
      const seatMeta = seat && seat.occupied ? (seat.connected ? "Waiting in lobby" : "Disconnected") : "Available";
      panel.className = `player-panel ${slot === 0 ? "human-panel" : "opponent-panel"}`;
      panel.innerHTML = `
        <div class="player-head">
          <div>
            <div class="player-name">${escapeHtml(seatTitle)}</div>
            <div class="player-meta">${escapeHtml(seatMeta)}</div>
          </div>
          <div class="badges">
            ${roomInfo.mySeatIndex === seatIndex ? '<span class="badge turn">You</span>' : ""}
            ${roomInfo.hostSeatIndex === seatIndex ? '<span class="badge">Host</span>' : ""}
          </div>
        </div>
        <div class="opponent-hand"></div>
      `;
      return;
    }

    const player = game.state.players[seatIndex];
    const isSelf = seatIndex === roomInfo.mySeatIndex;
    const isTurn = game.state.currentPlayerIndex === seatIndex && !game.state.roundOver && !roomInfo.paused;
    panel.className = `player-panel ${isSelf ? "human-panel" : "opponent-panel"} ${isTurn ? "current-turn" : ""}`;

    const badges = [];
    if (game.state.dealerIndex === seatIndex) badges.push('<span class="badge">Dealer</span>');
    if (roomInfo.hostSeatIndex === seatIndex) badges.push('<span class="badge">Host</span>');
    if (isSelf) badges.push('<span class="badge turn">You</span>');
    if (isTurn) badges.push('<span class="badge turn">Turn</span>');
    badges.push(`<span class="badge ${player.opened ? "" : "warn"}">${player.opened ? "Open" : "Unopened"}</span>`);
    if (player.drawBlocked) badges.push('<span class="badge warn">Draw blocked</span>');
    if (player.burned) badges.push('<span class="badge danger">Sunog</span>');
    if (seat && !seat.connected) badges.push('<span class="badge danger">Offline</span>');

    const deadwood = isSelf || game.state.roundOver ? L.bestDeadwood(player.hand.filter(Boolean)).points : null;
    const meta = isSelf
      ? `Hand ${player.hand.length} cards - deadwood ${deadwood}`
      : `${player.hand.length} cards`;

    const handHtml = isSelf
      ? renderHumanHand(player)
      : `<div class="opponent-hand">${player.hand.map(() => renderCard(null, { back: true })).join("")}</div>`;

    panel.innerHTML = `
      <div class="player-head">
        <div>
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="badges">${badges.join("")}</div>
      </div>
      ${handHtml}
    `;
  }

  function renderPiles() {
    if (!game) {
      els["stock-count"].textContent = "0 cards";
      els["discard-pile"].classList.add("empty");
      els["discard-pile"].innerHTML = "";
      els["discard-label"].textContent = "Empty";
      return;
    }
    els["stock-count"].textContent = `${game.state.stock.length} card${game.state.stock.length === 1 ? "" : "s"}`;
    const top = game.state.discard[game.state.discard.length - 1];
    els["discard-pile"].classList.toggle("empty", !top);
    els["discard-pile"].innerHTML = top ? renderCard(top) : "";
    els["discard-label"].textContent = top ? L.cardLabel(top) : "Empty";
  }

  function renderTurnBanner() {
    if (!roomInfo.code) {
      els["turn-banner"].textContent = "Connect to your Render game server and create or join a room.";
      return;
    }
    if (!game) {
      const seated = roomInfo.seats.filter((seat) => seat.occupied).length;
      els["turn-banner"].textContent = `Lobby ${roomInfo.code}: ${seated}/3 seats filled.`;
      return;
    }
    if (roomInfo.paused) {
      els["turn-banner"].textContent = roomInfo.pauseReason || "The room is paused.";
      return;
    }
    if (game.state.roundOver) {
      const summary = game.state.roundSummary;
      els["turn-banner"].textContent = summary ? `Round over: ${summary.winnerName} by ${summary.reasonLabel}` : "Round over";
      return;
    }
    if (game.state.pendingDraw) {
      const caller = game.state.players[game.state.pendingDraw.callerIndex].name;
      const responder = game.getCurrentDrawResponder();
      els["turn-banner"].textContent =
        responder === null ? `${caller}'s Draw is resolving.` : `${caller} called Draw. ${game.state.players[responder].name} must answer.`;
      return;
    }
    const player = game.state.players[game.state.currentPlayerIndex];
    const phaseText = {
      dealerDiscard: "may expose melds, sapaw, call Tongits, or discard",
      awaitDraw: "must draw, or may call Draw if eligible",
      afterDraw: "may meld, sapaw, call Tongits, then discard",
      mustMeldDiscard: "must expose a meld containing the picked discard"
    }[game.state.phase] || game.state.phase;
    els["turn-banner"].textContent = `${player.name}: ${phaseText}.`;
  }

  function canUseSapaw(meld) {
    if (!currentPlayerCanAct() || !game) return false;
    if (!["afterDraw", "dealerDiscard"].includes(game.state.phase)) return false;
    if (selected.size !== 1) return false;
    const card = selectedCards()[0];
    return Boolean(card && game.canLayOffCard(card, meld));
  }

  function renderMeldBoard() {
    if (!game) {
      els["meld-board"].innerHTML = seatOrder()
        .map((seatIndex) => `<section class="meld-lane"><h3>${escapeHtml(roomInfo.seats[seatIndex].name)} exposed melds</h3><p class="player-meta">No exposed melds yet.</p></section>`)
        .join("");
      return;
    }

    els["meld-board"].innerHTML = seatOrder()
      .map((seatIndex) => {
        const player = game.state.players[seatIndex];
        const stacks = player.melds.length
          ? player.melds
              .map((meld) => {
                const sapawButton = canUseSapaw(meld)
                  ? `<button class="mini-action sapaw-btn" type="button" data-owner="${seatIndex}" data-meld-id="${meld.id}">Sapaw</button>`
                  : "";
                return `<div class="meld-group" data-owner="${seatIndex}" data-meld-id="${meld.id}">
                  <div class="meld-title">
                    <span>${meld.type.toUpperCase()} - ${meld.cards.length} cards</span>
                    ${sapawButton}
                  </div>
                  <div class="card-row">${meld.cards.map((card) => renderCard(card, { small: true })).join("")}</div>
                </div>`;
              })
              .join("")
          : `<p class="player-meta">No exposed melds.</p>`;
        return `<section class="meld-lane">
          <h3>${escapeHtml(player.name)} exposed melds</h3>
          <div class="meld-stack">${stacks}</div>
        </section>`;
      })
      .join("");
  }

  function renderSelectedReadout() {
    const cards = selectedCards();
    const label = cards.length ? cards.map(L.cardLabel).join(" ") : "None";
    const type = cards.length >= 3 ? L.getMeldType(cards) : null;
    els["selected-readout"].textContent = type ? `${label} - legal ${type}` : label;
  }

  function setButtonStates() {
    const humanTurn = currentPlayerCanAct();
    const state = game && game.state;
    const phase = state ? state.phase : "";
    const drawCheck = game && roomInfo.mySeatIndex !== null ? game.canCallDraw(roomInfo.mySeatIndex) : { ok: false };
    const tongitsCheck = game && roomInfo.mySeatIndex !== null ? game.canCallTongits(roomInfo.mySeatIndex) : { ok: false };
    els["draw-stock-btn"].disabled = !(humanTurn && phase === "awaitDraw" && state.stock.length > 0);
    els["take-discard-btn"].disabled = !(humanTurn && phase === "awaitDraw" && game.getDiscardMeldOptions(roomInfo.mySeatIndex).length > 0);
    els["lay-meld-btn"].disabled = !(humanTurn && ["afterDraw", "dealerDiscard", "mustMeldDiscard"].includes(phase) && selected.size >= 3);
    els["discard-btn"].disabled = !(humanTurn && ["afterDraw", "dealerDiscard"].includes(phase) && selected.size === 1);
    els["tongits-btn"].disabled = !(humanTurn && tongitsCheck.ok);
    els["draw-call-btn"].disabled = !(humanTurn && drawCheck.ok);
    els["sort-hand-btn"].disabled = !game;
    els["auto-group-btn"].disabled = !game;
    els["auto-group-btn"].textContent = `Auto Group: ${handGroupingEnabled ? "On" : "Off"}`;
    els["leave-room-btn"].disabled = !roomInfo.code;

    const responder = game ? game.getCurrentDrawResponder() : null;
    const humanResponding = Boolean(game && state.pendingDraw && responder === roomInfo.mySeatIndex);
    els["draw-response"].hidden = !humanResponding;
    if (humanResponding) {
      const caller = state.players[state.pendingDraw.callerIndex].name;
      els["draw-response-title"].textContent = `${caller} called Draw`;
      els["draw-response-copy"].textContent = "You have an exposed meld, so you may challenge. Folding avoids the point comparison.";
    }
  }

  function renderLog() {
    const entries = game ? game.log : [];
    els["game-log"].innerHTML = entries
      .slice(-80)
      .reverse()
      .map((entry) => `<div class="log-entry ${entry.type}">
        <strong>${escapeHtml(entry.time)} - ${escapeHtml(entry.type)}</strong>
        ${escapeHtml(entry.text)}
      </div>`)
      .join("");
  }

  function renderSummary() {
    const summary = game && game.state.roundSummary;
    if (!summary || !game.state.roundOver) {
      els["summary-panel"].hidden = true;
      return;
    }

    const calloutByReason = {
      tongits: "TONGITS!",
      draw: summary.challengers.length ? "DRAW CHALLENGE!" : "DRAW!",
      stock: summary.winnerIndex === null || summary.winnerIndex === undefined ? "DECK EMPTY!" : "LOW POINTS!"
    };
    const callout = calloutByReason[summary.reason] || `${summary.reasonLabel.toUpperCase()}!`;
    const winLine =
      summary.winnerIndex === null || summary.winnerIndex === undefined
        ? "No eligible winner"
        : `${summary.winnerName} wins`;
    const howLine =
      summary.reason === "tongits"
        ? `${summary.winnerName} emptied the hand or grouped every remaining card into legal melds.`
        : summary.reason === "draw"
          ? `${summary.winnerName} won the Draw resolution${summary.challengers.length ? " after a challenge" : " after folds"}.`
          : summary.winnerIndex === null || summary.winnerIndex === undefined
            ? "The stock ran out and every player was sunog, so no low-point winner was awarded."
            : `${summary.winnerName} won the low-point comparison after the stock ran out.`;

    els["summary-title"].textContent = `Round ${summary.roundNumber}`;
    const playersHtml = game.state.players
      .map((player) => {
        const dead = summary.deadwood[player.index];
        const payment = summary.payments[player.index];
        const deadCards = dead.deadwoodCards.length ? dead.deadwoodCards.map(L.cardLabel).join(" ") : "none";
        const hiddenMelds = dead.coveredMelds.length
          ? dead.coveredMelds.map((meld) => `${meld.type}: ${meld.cards.map(L.cardLabel).join(" ")}`).join("; ")
          : "none";
        const classes = [
          "summary-player",
          summary.winnerIndex === player.index ? "winner" : "",
          summary.burned[player.index] ? "burned" : ""
        ].filter(Boolean).join(" ");
        return `<section class="${classes}">
          <h3>${escapeHtml(player.name)} ${summary.winnerIndex === player.index ? "wins" : ""}</h3>
          <p><strong>Opened:</strong> ${summary.opened[player.index] ? "yes" : "no"} - <strong>Sunog:</strong> ${summary.burned[player.index] ? "yes" : "no"}</p>
          <p><strong>Deadwood:</strong> ${dead.points} (${escapeHtml(deadCards)})</p>
          <p><strong>Hidden meld credit:</strong> ${escapeHtml(hiddenMelds)}</p>
          <p><strong>Score change:</strong> ${payment > 0 ? "+" : ""}${payment}</p>
        </section>`;
      })
      .join("");

    const details = summary.details.length
      ? `<ul>${summary.details.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "<p>No score exchanged.</p>";

    els["summary-content"].innerHTML = `
      <section class="summary-callout ${summary.reason}">
        <div class="summary-callout-label">${escapeHtml(callout)}</div>
        <div class="summary-winner-line">${escapeHtml(winLine)}</div>
        <p>${escapeHtml(howLine)}</p>
      </section>
      <p><strong>Details:</strong> ${escapeHtml(summary.detail)}</p>
      <div class="summary-grid">${playersHtml}</div>
      <h3>Payments</h3>
      ${details}
    `;
    els["next-round-btn"].disabled = !roomInfo.isHost;
    els["next-round-btn"].textContent = roomInfo.isHost ? "Next Round" : "Waiting For Host";
    els["summary-panel"].hidden = false;
  }

  function renderLobbyOverlay() {
    const shouldShow = !roomInfo.code || !game || roomInfo.paused;
    els["lobby-panel"].hidden = !shouldShow;
    const inLobbyRoom = Boolean(roomInfo.code);
    const matchActive = Boolean(game);

    els["player-name-input"].disabled = matchActive;
    els["server-url-input"].disabled = inLobbyRoom;
    els["room-code-input"].disabled = matchActive;
    els["create-room-btn"].disabled = inLobbyRoom;
    els["join-room-btn"].disabled = inLobbyRoom || matchActive;

    if (!roomInfo.code) {
      els["lobby-title"].textContent = "Multiplayer Lobby";
      els["lobby-copy"].textContent = "Enter your name, confirm the server, then create or join a 3-player room.";
      els["lobby-room-code"].textContent = "-";
      els["lobby-seat-label"].textContent = "-";
      els["lobby-host-label"].textContent = "-";
      els["lobby-seats"].innerHTML = [0, 1, 2].map((seatIndex) => `<div class="lobby-seat"><strong>Seat ${seatIndex + 1}</strong><span>Open</span></div>`).join("");
      els["copy-room-btn"].disabled = true;
      els["start-match-btn"].disabled = true;
      els["start-match-btn"].textContent = "Start Match";
      return;
    }

    const hostSeat = roomInfo.hostSeatIndex !== null && roomInfo.hostSeatIndex !== undefined ? roomInfo.seats[roomInfo.hostSeatIndex] : null;
    els["lobby-room-code"].textContent = roomInfo.code;
    els["lobby-seat-label"].textContent = roomInfo.mySeatIndex === null || roomInfo.mySeatIndex === undefined ? "-" : `${roomInfo.mySeatIndex + 1}`;
    els["lobby-host-label"].textContent = hostSeat ? hostSeat.name : "-";

    if (!game) {
      els["lobby-title"].textContent = `Room ${roomInfo.code}`;
      els["lobby-copy"].textContent = roomInfo.canStart
        ? "All 3 players are seated. Host can start the match now."
        : "Waiting for all 3 seats to fill before the host can start.";
      els["start-match-btn"].disabled = !(roomInfo.isHost && roomInfo.canStart);
      els["start-match-btn"].textContent = roomInfo.isHost ? "Start Match" : "Host Starts Match";
    } else {
      els["lobby-title"].textContent = `Room ${roomInfo.code} Paused`;
      els["lobby-copy"].textContent = roomInfo.pauseReason || "Waiting for every player to reconnect.";
      els["start-match-btn"].disabled = true;
      els["start-match-btn"].textContent = "Match Paused";
    }

    els["copy-room-btn"].disabled = false;
    els["lobby-seats"].innerHTML = roomInfo.seats
      .map((seat) => `<div class="lobby-seat ${seat.occupied ? "" : "open"} ${seat.index === roomInfo.mySeatIndex ? "mine" : ""}">
        <strong>Seat ${seat.index + 1}</strong>
        <span>${escapeHtml(seat.name)}</span>
        <small>${seat.occupied ? (seat.connected ? "Connected" : "Disconnected") : "Open"}</small>
      </div>`)
      .join("");
  }

  function renderConnectionState() {
    renderMultiplayerStatus();
    renderLobbyOverlay();
  }

  function render(scheduleAnimations) {
    renderConnectionState();
    renderScoreStrip();
    renderPiles();
    renderTurnBanner();
    renderMeldBoard();
    renderPlayerSlot(1);
    renderPlayerSlot(2);
    renderPlayerSlot(0);
    renderSelectedReadout();
    setButtonStates();
    renderLog();
    renderSummary();
    wireDynamicEvents();
    if (scheduleAnimations !== false) handleNewEvents();
  }

  function animateElement(element, className, duration) {
    if (!element) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), duration || 780);
  }

  function flyCard(card, fromElement, toElement, options) {
    if (!fromElement || !toElement) return;
    const settings = Object.assign({ delay: 0, back: false, rotate: 4, scale: 1 }, options || {});
    window.setTimeout(() => {
      const from = fromElement.getBoundingClientRect();
      const to = toElement.getBoundingClientRect();
      if (!from.width || !to.width) return;

      const ghostWrap = document.createElement("div");
      ghostWrap.innerHTML = renderCard(card, { back: settings.back });
      const ghost = ghostWrap.firstElementChild;
      ghost.classList.add("card-ghost");

      const width = Math.min(74, Math.max(48, from.width || 74));
      const height = width * 1.405;
      const startX = from.left + from.width / 2 - width / 2;
      const startY = from.top + from.height / 2 - height / 2;
      const endX = to.left + to.width / 2 - width / 2;
      const endY = to.top + to.height / 2 - height / 2;

      ghost.style.width = `${width}px`;
      ghost.style.height = `${height}px`;
      ghost.style.left = `${startX}px`;
      ghost.style.top = `${startY}px`;
      ghost.style.transform = "translate(0, 0) rotate(0deg) scale(1)";
      document.body.appendChild(ghost);

      window.requestAnimationFrame(() => {
        ghost.classList.add("in-flight");
        ghost.style.transform = `translate(${endX - startX}px, ${endY - startY}px) rotate(${settings.rotate}deg) scale(${settings.scale})`;
      });

      window.setTimeout(() => ghost.remove(), 760);
    }, settings.delay);
  }

  function emphasizeDrawnCard(data) {
    window.setTimeout(() => {
      if (data.playerIndex === roomInfo.mySeatIndex && data.card) {
        const card = cardElement(data.card.id);
        if (card) {
          animateElement(card, "anim-new-card-glow", 4200);
          return;
        }
      }
      animateElement(playerPanel(data.playerIndex), "anim-hidden-card-glow", 1200);
    }, 620);
  }

  function animateEvent(entry) {
    if (!game) return;
    const data = entry.data || {};
    if (entry.type === "shuffle") {
      animateElement(els["card-table"], "anim-shuffle", 1100);
      animateElement(els["stock-pile"], "anim-stock-ready", 900);
    } else if (entry.type === "deal") {
      game.state.players.forEach((player) => animateElement(playerPanel(player.index), "anim-deal-receive", 900));
      game.state.players.forEach((player, playerOffset) => {
        for (let i = 0; i < 3; i += 1) {
          flyCard(null, els["stock-pile"], playerPanel(player.index), {
            back: true,
            delay: playerOffset * 70 + i * 130,
            rotate: player.index === roomInfo.mySeatIndex ? 2 : (seatToSlot(player.index) === 1 ? -6 : 6),
            scale: player.index === roomInfo.mySeatIndex ? 1 : .72
          });
        }
      });
    } else if (entry.type === "turn") {
      animateElement(playerPanel(data.playerIndex), "anim-turn-arrive", 760);
      animateElement(els["turn-banner"], "anim-turn-banner", 760);
    } else if (entry.type === "draw") {
      if (data.source === "stock") animateElement(els["stock-pile"], "anim-stock-draw", 720);
      if (data.source === "discard") animateElement(els["discard-pile"], "anim-discard-take", 720);
      animateElement(playerPanel(data.playerIndex), "anim-card-receive", 760);
      flyCard(data.card, data.source === "stock" ? els["stock-pile"] : els["discard-pile"], playerPanel(data.playerIndex), {
        back: data.source === "stock" && data.playerIndex !== roomInfo.mySeatIndex,
        rotate: data.playerIndex === roomInfo.mySeatIndex ? 2 : (seatToSlot(data.playerIndex) === 1 ? -6 : 6),
        scale: data.playerIndex === roomInfo.mySeatIndex ? 1 : .72
      });
      emphasizeDrawnCard(data);
    } else if (entry.type === "discard") {
      animateElement(playerPanel(data.playerIndex), "anim-card-send", 680);
      animateElement(els["discard-pile"], "anim-discard-land", 820);
      flyCard(data.card, playerPanel(data.playerIndex), els["discard-pile"], {
        rotate: seatToSlot(data.playerIndex) === 1 ? 7 : -7,
        scale: 1
      });
    } else if (entry.type === "meld") {
      animateElement(playerPanel(data.playerIndex), "anim-card-send", 680);
      animateElement(meldElement(data.meldId), "anim-meld-open", 900);
      (data.cards || []).forEach((card, index) => {
        flyCard(card, playerPanel(data.playerIndex), meldElement(data.meldId), {
          delay: index * 90,
          rotate: -4 + index * 2,
          scale: .72
        });
      });
    } else if (entry.type === "sapaw") {
      animateElement(playerPanel(data.playerIndex), "anim-card-send", 680);
      animateElement(meldElement(data.meldId), "anim-sapaw-land", 900);
      animateElement(playerPanel(data.ownerIndex), "anim-draw-blocked", 900);
      flyCard(data.card, playerPanel(data.playerIndex), meldElement(data.meldId), {
        rotate: 6,
        scale: .72
      });
    } else if (entry.type === "draw-call") {
      animateElement(playerPanel(data.callerIndex), "anim-draw-call", 900);
      animateElement(els["card-table"], "anim-table-tension", 900);
    } else if (entry.type === "challenge") {
      animateElement(playerPanel(data.playerIndex), "anim-challenge", 820);
    } else if (entry.type === "fold") {
      animateElement(playerPanel(data.playerIndex), "anim-fold", 740);
    } else if (entry.type === "burn") {
      animateElement(playerPanel(data.playerIndex), "anim-burn", 1100);
    } else if (entry.type === "win") {
      animateElement(playerPanel(data.winnerIndex), "anim-win", 1200);
      animateElement(els["card-table"], "anim-win-table", 1200);
    } else if (entry.type === "invalid") {
      animateElement(els.feedback, "anim-feedback", 620);
    }
  }

  function handleNewEvents() {
    const entries = game ? game.log : [];
    const newEntries = entries.filter((entry) => entry.id > lastHandledEventId);
    newEntries.forEach((entry, index) => {
      window.setTimeout(() => {
        audio.play(entry.type);
        animateEvent(entry);
      }, index * 120);
    });
    if (newEntries.length) lastHandledEventId = newEntries[newEntries.length - 1].id;
  }

  function applySnapshot(snapshot) {
    roomInfo = snapshot.room || createEmptyRoomInfo();
    game = snapshot.game ? wrapGame(snapshot.game) : null;
    localStorage.setItem("tongitsRoomCode", roomInfo.code || "");
    if (!game) selected.clear();
    render();
  }

  function resetRoomState(message) {
    roomInfo = createEmptyRoomInfo();
    game = null;
    selected.clear();
    lastHandledEventId = 0;
    clearSavedRoom();
    if (message) setFeedback(message);
    render(false);
  }

  function ensureSocket() {
    const url = configuredServerUrl();
    if (!url) throw new Error("Enter your Render server URL first.");
    saveClientPrefs();

    if (socket && socket.connected && socketUrl === url) return socket;
    if (socket && socketUrl === url) return socket;

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }

    socketUrl = url;
    resumeAttempted = false;
    connectionText = `Connecting to ${url}...`;
    render(false);

    socket = window.io(url, {
      transports: ["websocket", "polling"],
      withCredentials: true
    });

    socket.on("connect", () => {
      connectionText = `Connected to ${url}`;
      render(false);
      if (!resumeAttempted && localStorage.getItem("tongitsRoomCode")) {
        resumeAttempted = true;
        emitWithAck("lobby:resume", {
          roomCode: localStorage.getItem("tongitsRoomCode"),
          token: playerToken()
        }).catch(() => {});
      }
    });

    socket.on("disconnect", () => {
      connectionText = `Disconnected from ${url}`;
      render(false);
    });

    socket.on("connect_error", (error) => {
      connectionText = `Connection failed: ${error.message}`;
      render(false);
    });

    socket.on("room:update", (snapshot) => {
      connectionText = `Connected to ${url}`;
      applySnapshot(snapshot);
    });

    socket.on("room:closed", (payload) => {
      resetRoomState(payload && payload.message ? payload.message : "The room was closed.");
    });

    return socket;
  }

  function emitWithAck(event, payload) {
    return new Promise((resolve, reject) => {
      const activeSocket = ensureSocket();
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error("The server did not respond in time."));
      }, 8000);

      activeSocket.emit(event, payload, (response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (response && response.ok !== false) resolve(response || { ok: true });
        else reject(new Error(response && response.error ? response.error : "Request failed."));
      });
    });
  }

  async function createRoom() {
    try {
      audio.unlock();
      saveClientPrefs();
      const response = await emitWithAck("lobby:create", {
        token: playerToken(),
        name: playerName()
      });
      els["room-code-input"].value = response.roomCode;
      localStorage.setItem("tongitsRoomCode", response.roomCode);
      setFeedback(`Room ${response.roomCode} created. Share the code with two other players.`);
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function joinRoom() {
    const roomCode = normalizedRoomCode();
    if (!roomCode) {
      setFeedback("Enter a room code first.");
      return;
    }
    try {
      audio.unlock();
      saveClientPrefs();
      await emitWithAck("lobby:join", {
        roomCode,
        token: playerToken(),
        name: playerName()
      });
      localStorage.setItem("tongitsRoomCode", roomCode);
      setFeedback(`Joined room ${roomCode}.`);
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function leaveRoom() {
    if (!roomInfo.code) return;
    try {
      audio.unlock();
      await emitWithAck("lobby:leave", {
        roomCode: roomInfo.code,
        token: playerToken()
      });
      resetRoomState("You left the room.");
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function startMatch() {
    if (!roomInfo.code) return;
    try {
      audio.unlock();
      await emitWithAck("lobby:start", {
        roomCode: roomInfo.code,
        token: playerToken()
      });
      setFeedback("Match starting...");
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function nextRound() {
    if (!roomInfo.code) return;
    try {
      audio.unlock();
      await emitWithAck("room:nextRound", {
        roomCode: roomInfo.code,
        token: playerToken()
      });
      els["summary-panel"].hidden = true;
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function copyRoomCode() {
    if (!roomInfo.code) return;
    try {
      await navigator.clipboard.writeText(roomInfo.code);
      setFeedback(`Copied room code ${roomInfo.code}.`);
    } catch (_error) {
      setFeedback(`Room code: ${roomInfo.code}`);
    }
  }

  async function sendGameAction(action, clearSelection) {
    if (!roomInfo.code) return;
    try {
      audio.unlock();
      await emitWithAck("game:action", {
        roomCode: roomInfo.code,
        token: playerToken(),
        action
      });
      if (clearSelection) selected.clear();
      setFeedback("");
    } catch (error) {
      setFeedback(error.message);
    }
  }

  function readDraggedIds(event) {
    try {
      return JSON.parse(event.dataTransfer.getData("text/plain")) || [];
    } catch (_error) {
      return [];
    }
  }

  function wireDynamicEvents() {
    document.querySelectorAll("#player-0 .card[data-card-id]").forEach((node) => {
      node.addEventListener("click", () => {
        audio.unlock();
        const id = node.dataset.cardId;
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        setFeedback("");
        render(false);
      });
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          node.click();
        }
      });
      node.addEventListener("dragstart", (event) => {
        audio.unlock();
        const id = node.dataset.cardId;
        if (!selected.has(id)) {
          selected.clear();
          selected.add(id);
        }
        node.classList.add("dragging");
        event.dataTransfer.setData("text/plain", JSON.stringify(Array.from(selected)));
      });
      node.addEventListener("dragend", () => {
        node.classList.remove("dragging");
      });
    });

    document.querySelectorAll(".sapaw-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const card = selectedCards()[0];
        if (!card) {
          setFeedback("Select one card to sapaw.");
          return;
        }
        sendGameAction({
          type: "layOff",
          cardId: card.id,
          ownerIndex: Number(button.dataset.owner),
          meldId: button.dataset.meldId
        }, true);
      });
    });

    document.querySelectorAll(".hidden-group-select").forEach((button) => {
      button.addEventListener("click", () => {
        const player = myPlayer();
        if (!player) return;
        const group = getHiddenHandGroups(player)[Number(button.dataset.groupIndex)];
        if (!group || group.type === "deadwood") return;
        selected.clear();
        group.cards.forEach((card) => selected.add(card.id));
        setFeedback(`${group.type} selected. Use Lay Meld to expose it, or keep it hidden in hand.`);
        render(false);
      });
    });

    document.querySelectorAll(".required-meld-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const player = myPlayer();
        if (!player) return;
        const group = getRequiredDiscardMeldGroups(player)[Number(button.dataset.groupIndex)];
        if (!group) {
          setFeedback("That required discard meld is no longer available.");
          return;
        }
        selected.clear();
        group.cards.forEach((card) => selected.add(card.id));
        sendGameAction({ type: "exposeMeld", cardIds: group.cards.map((card) => card.id) }, true);
      });
    });

    document.querySelectorAll(".meld-group").forEach((group) => {
      group.addEventListener("dragover", (event) => {
        event.preventDefault();
        group.classList.add("drop-ready");
      });
      group.addEventListener("dragleave", () => group.classList.remove("drop-ready"));
      group.addEventListener("drop", (event) => {
        event.preventDefault();
        group.classList.remove("drop-ready");
        const dragged = readDraggedIds(event);
        if (dragged.length !== 1) {
          setFeedback("Drop exactly one card onto an exposed meld for sapaw.");
          return;
        }
        sendGameAction({
          type: "layOff",
          cardId: dragged[0],
          ownerIndex: Number(group.dataset.owner),
          meldId: group.dataset.meldId
        }, true);
      });
    });
  }

  function bindStaticEvents() {
    els["create-room-btn"].addEventListener("click", createRoom);
    els["join-room-btn"].addEventListener("click", joinRoom);
    els["leave-room-btn"].addEventListener("click", leaveRoom);
    els["start-match-btn"].addEventListener("click", startMatch);
    els["copy-room-btn"].addEventListener("click", copyRoomCode);
    els["next-round-btn"].addEventListener("click", nextRound);

    els["player-name-input"].addEventListener("change", saveClientPrefs);
    els["server-url-input"].addEventListener("change", saveClientPrefs);
    els["room-code-input"].addEventListener("change", () => {
      els["room-code-input"].value = normalizedRoomCode();
      saveClientPrefs();
    });

    els["card-theme-select"].addEventListener("change", () => {
      applyCardTheme();
      render(false);
    });

    els["rules-btn"].addEventListener("click", () => {
      audio.unlock();
      els["rules-panel"].hidden = false;
    });

    els["close-rules-btn"].addEventListener("click", () => {
      els["rules-panel"].hidden = true;
    });

    els["rules-panel"].addEventListener("click", (event) => {
      if (event.target === els["rules-panel"]) els["rules-panel"].hidden = true;
    });

    els["draw-stock-btn"].addEventListener("click", () => sendGameAction({ type: "drawStock" }, true));
    els["take-discard-btn"].addEventListener("click", () => sendGameAction({ type: "takeDiscard" }, true));
    els["lay-meld-btn"].addEventListener("click", () => sendGameAction({ type: "exposeMeld", cardIds: Array.from(selected) }, true));
    els["tongits-btn"].addEventListener("click", () => sendGameAction({ type: "callTongits" }, true));
    els["draw-call-btn"].addEventListener("click", () => sendGameAction({ type: "callDraw" }, true));
    els["challenge-btn"].addEventListener("click", () => sendGameAction({ type: "drawResponse", response: "challenge" }, true));
    els["fold-btn"].addEventListener("click", () => sendGameAction({ type: "drawResponse", response: "fold" }, true));

    els["discard-btn"].addEventListener("click", () => {
      const cards = Array.from(selected);
      if (cards.length !== 1) {
        setFeedback("Select exactly one card to discard.");
        return;
      }
      sendGameAction({ type: "discard", cardId: cards[0] }, true);
    });

    els["sort-hand-btn"].addEventListener("click", () => {
      const player = myPlayer();
      if (!player) return;
      player.hand = L.sortCards(player.hand.filter(Boolean));
      handGroupingEnabled = false;
      render(false);
    });

    els["auto-group-btn"].addEventListener("click", () => {
      handGroupingEnabled = !handGroupingEnabled;
      render(false);
    });

    els["stock-pile"].addEventListener("click", () => {
      if (!els["draw-stock-btn"].disabled) sendGameAction({ type: "drawStock" }, true);
    });

    els["discard-pile"].addEventListener("click", () => {
      if (!els["take-discard-btn"].disabled) sendGameAction({ type: "takeDiscard" }, true);
    });

    els["discard-pile"].addEventListener("dragover", (event) => {
      event.preventDefault();
      els["discard-pile"].classList.add("drop-ready");
    });

    els["discard-pile"].addEventListener("dragleave", () => {
      els["discard-pile"].classList.remove("drop-ready");
    });

    els["discard-pile"].addEventListener("drop", (event) => {
      event.preventDefault();
      els["discard-pile"].classList.remove("drop-ready");
      const dragged = readDraggedIds(event);
      if (dragged.length !== 1) {
        setFeedback("Drop exactly one card onto the discard pile.");
        return;
      }
      selected.clear();
      selected.add(dragged[0]);
      sendGameAction({ type: "discard", cardId: dragged[0] }, true);
    });
  }

  function init() {
    cacheEls();
    initFormDefaults();
    bindStaticEvents();
    render(false);
  }

  init();
})();
