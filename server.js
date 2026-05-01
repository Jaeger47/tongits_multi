// Author: Mark Daniel G. Dacer

"use strict";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const TongitsLogic = require("./game-logic");
const TongitsAI = require("./ai");

const PORT = Number(process.env.PORT || 3000);
const ROOM_SIZE = 3;
const ROOM_CODE_LENGTH = 6;
const BOT_ACTION_DELAY_MS = 1250;
const BOT_RESPONSE_DELAY_MS = 900;
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "Dacer_2026!");
const BOT_NAMES_BY_SEAT = ["Bot One", "Maya", "Lito"];

const app = express();
app.use(express.json());

const rooms = new Map();
const socketIndex = new Map();
const adminSessions = new Map();

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, now: new Date().toISOString() });
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "admin.html"));
});

if (process.env.SERVE_STATIC !== "0") {
  app.use(express.static(path.resolve(__dirname)));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
  }
});

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function createUniqueRoomCode() {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();
  return code;
}

function normalizeName(name) {
  return String(name || "").trim().slice(0, 24) || "Player";
}

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase().slice(0, ROOM_CODE_LENGTH);
}

function normalizeDifficulty(difficulty) {
  const value = String(difficulty || "").trim().toLowerCase();
  return ["easy", "medium", "hard"].includes(value) ? value : "medium";
}

function normalizeHumanPlayers(count) {
  const value = Number(count);
  if (!Number.isFinite(value)) return ROOM_SIZE;
  return Math.max(1, Math.min(ROOM_SIZE, Math.floor(value)));
}

function compareSecret(input, expected) {
  const a = Buffer.from(String(input || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function cloneCard(card) {
  return card ? { id: card.id, suit: card.suit, rank: card.rank } : null;
}

function cloneMeld(meld) {
  return {
    id: meld.id,
    ownerIndex: meld.ownerIndex,
    type: meld.type,
    cards: meld.cards.map(cloneCard)
  };
}

function makeHumanSeat(index) {
  return {
    index,
    type: "human",
    token: null,
    socketId: null,
    connected: false,
    name: `Open seat ${index + 1}`,
    difficulty: "human"
  };
}

function makeBotSeat(index, difficulty) {
  return {
    index,
    type: "bot",
    token: null,
    socketId: null,
    connected: true,
    name: BOT_NAMES_BY_SEAT[index] || `Bot ${index + 1}`,
    difficulty: normalizeDifficulty(difficulty)
  };
}

function seatOccupied(seat) {
  return seat.type === "bot" || Boolean(seat.token);
}

function isHumanSeat(seat) {
  return seat.type === "human";
}

function isBotSeat(seat) {
  return seat.type === "bot";
}

function humanSeats(room) {
  return room.seats.filter(isHumanSeat);
}

function joinedHumanSeatsCount(room) {
  return humanSeats(room).filter((seat) => seat.token).length;
}

function readyHumanSeatsCount(room) {
  return humanSeats(room).filter((seat) => seat.token && seat.connected).length;
}

function humanSeatCount(room) {
  return humanSeats(room).length;
}

function botSeatCount(room) {
  return room.seats.filter(isBotSeat).length;
}

function canStartRoom(room) {
  const humanCount = humanSeatCount(room);
  return !room.game && humanCount > 0 && readyHumanSeatsCount(room) === humanCount;
}

function getHostSeatIndex(room) {
  if (!room.hostToken) return null;
  const index = room.seats.findIndex((seat) => isHumanSeat(seat) && seat.token === room.hostToken);
  return index >= 0 ? index : null;
}

function ensureHost(room) {
  if (getHostSeatIndex(room) !== null) return;
  const nextHost = room.seats.find((seat) => isHumanSeat(seat) && seat.token);
  room.hostToken = nextHost ? nextHost.token : null;
}

function getSeatIndexByToken(room, token) {
  return room.seats.findIndex((seat) => isHumanSeat(seat) && seat.token === token);
}

function findFirstOpenHumanSeat(room) {
  return room.seats.findIndex((seat) => isHumanSeat(seat) && !seat.token);
}

function clearHumanSeat(seat) {
  seat.token = null;
  seat.socketId = null;
  seat.connected = false;
  seat.name = `Open seat ${seat.index + 1}`;
}

function addSocketIndex(socket, roomCode, token) {
  socketIndex.set(socket.id, { roomCode, token });
}

function removeSocketIndex(socketId) {
  socketIndex.delete(socketId);
}

function makeRoom(payload) {
  const humanPlayers = normalizeHumanPlayers(payload && payload.humanPlayers);
  const botDifficulty = normalizeDifficulty(payload && payload.botDifficulty);
  const seats = [];
  for (let index = 0; index < ROOM_SIZE; index += 1) {
    seats.push(index < humanPlayers ? makeHumanSeat(index) : makeBotSeat(index, botDifficulty));
  }
  return {
    code: createUniqueRoomCode(),
    createdAt: new Date().toISOString(),
    hostToken: null,
    seats,
    game: null,
    paused: false,
    pauseReason: "",
    botTimer: null,
    botBusy: false,
    config: {
      humanPlayers,
      botDifficulty
    }
  };
}

function getPlayerConfigs(room) {
  return room.seats.map((seat, index) => ({
    id: `room-${room.code}-seat-${index + 1}`,
    name: seat.name,
    isBot: isBotSeat(seat),
    difficulty: isBotSeat(seat) ? seat.difficulty : "human"
  }));
}

function getCurrentDrawResponder(state) {
  const pending = state.pendingDraw;
  if (!pending) return null;
  if (pending.position >= pending.responderOrder.length) return null;
  return pending.responderOrder[pending.position];
}

function sanitizeSeatForClient(seat) {
  return {
    index: seat.index,
    type: seat.type,
    name: seat.name,
    connected: isBotSeat(seat) ? true : seat.connected,
    occupied: seatOccupied(seat),
    difficulty: seat.difficulty,
    isBot: isBotSeat(seat)
  };
}

function sanitizePlayer(player, viewerSeatIndex, revealHands) {
  return {
    id: player.id,
    index: player.index,
    name: player.name,
    isBot: player.isBot,
    difficulty: player.difficulty,
    hand:
      revealHands || player.index === viewerSeatIndex
        ? player.hand.map(cloneCard)
        : new Array(player.hand.length).fill(null),
    melds: player.melds.map(cloneMeld),
    opened: player.opened,
    burned: player.burned,
    score: player.score,
    drawBlocked: player.drawBlocked,
    drawBlockReason: player.index === viewerSeatIndex ? player.drawBlockReason : ""
  };
}

function sanitizeState(game, viewerSeatIndex) {
  const state = game.state;
  const revealHands = Boolean(state.roundOver);
  return {
    roundNumber: state.roundNumber,
    phase: state.phase,
    players: state.players.map((player) => sanitizePlayer(player, viewerSeatIndex, revealHands)),
    dealerIndex: state.dealerIndex,
    currentPlayerIndex: state.currentPlayerIndex,
    stock: new Array(state.stock.length).fill(null),
    discard: state.discard.length ? [cloneCard(state.discard[state.discard.length - 1])] : [],
    lastStockDrawIndex: state.lastStockDrawIndex,
    stockExhaustedAfterTurn: state.stockExhaustedAfterTurn,
    requiredDiscardCardId:
      viewerSeatIndex === state.currentPlayerIndex && state.phase === "mustMeldDiscard"
        ? state.requiredDiscardCardId
        : null,
    pendingDraw: state.pendingDraw
      ? {
          callerIndex: state.pendingDraw.callerIndex,
          responderOrder: state.pendingDraw.responderOrder.slice(),
          position: state.pendingDraw.position,
          responses: Object.assign({}, state.pendingDraw.responses),
          folded: state.pendingDraw.folded.slice(),
          challengers: state.pendingDraw.challengers.slice()
        }
      : null,
    roundOver: state.roundOver,
    roundSummary: state.roundSummary,
    turnCounter: state.turnCounter,
    lastEvent: state.lastEvent
  };
}

function buildSnapshot(room, viewerToken) {
  const mySeatIndex = viewerToken ? getSeatIndexByToken(room, viewerToken) : -1;
  const hostSeatIndex = getHostSeatIndex(room);
  return {
    room: {
      code: room.code,
      started: Boolean(room.game),
      paused: room.paused,
      pauseReason: room.pauseReason,
      mySeatIndex: mySeatIndex >= 0 ? mySeatIndex : null,
      hostSeatIndex,
      isHost: mySeatIndex >= 0 && hostSeatIndex === mySeatIndex,
      canStart: canStartRoom(room),
      humanSeatCount: humanSeatCount(room),
      readyHumanSeatCount: readyHumanSeatsCount(room),
      joinedHumanSeatCount: joinedHumanSeatsCount(room),
      botSeatCount: botSeatCount(room),
      seats: room.seats.map(sanitizeSeatForClient)
    },
    game: room.game
      ? {
          state: sanitizeState(room.game, mySeatIndex),
          log: room.game.log.slice()
        }
      : null
  };
}

function buildAdminRoomSnapshot(room) {
  const state = room.game ? room.game.state : null;
  const hostSeatIndex = getHostSeatIndex(room);
  return {
    code: room.code,
    createdAt: room.createdAt,
    started: Boolean(room.game),
    paused: room.paused,
    pauseReason: room.pauseReason,
    canStart: canStartRoom(room),
    humanPlayers: humanSeatCount(room),
    joinedHumanPlayers: joinedHumanSeatsCount(room),
    readyHumanPlayers: readyHumanSeatsCount(room),
    botPlayers: botSeatCount(room),
    botDifficulty: room.config.botDifficulty,
    hostName: hostSeatIndex === null ? null : room.seats[hostSeatIndex].name,
    currentTurnName: state ? state.players[state.currentPlayerIndex].name : null,
    phase: state ? state.phase : null,
    roundNumber: state ? state.roundNumber : null,
    roundOver: state ? state.roundOver : false,
    stockCount: state ? state.stock.length : 0,
    discardTop: state && state.discard.length ? TongitsLogic.cardLabel(state.discard[state.discard.length - 1]) : null,
    botPending: Boolean(room.botTimer || room.botBusy),
    seats: room.seats.map((seat, index) => {
      const player = state ? state.players[index] : null;
      return {
        index,
        type: seat.type,
        name: seat.name,
        occupied: seatOccupied(seat),
        connected: isBotSeat(seat) ? true : seat.connected,
        difficulty: seat.difficulty,
        handCount: player ? player.hand.length : null,
        opened: player ? player.opened : false,
        burned: player ? player.burned : false,
        score: player ? player.score : 0
      };
    }),
    logTail: room.game ? room.game.log.slice(-6) : []
  };
}

function emitToRoom(room) {
  room.seats.forEach((seat) => {
    if (!isHumanSeat(seat) || !seat.socketId) return;
    io.to(seat.socketId).emit("room:update", buildSnapshot(room, seat.token));
  });
}

function clearBotTimer(room) {
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }
}

function closeRoom(room, message) {
  clearBotTimer(room);
  room.seats.forEach((seat) => {
    if (isHumanSeat(seat) && seat.socketId) {
      io.to(seat.socketId).emit("room:closed", { message });
      socketIndex.delete(seat.socketId);
    }
  });
  rooms.delete(room.code);
}

function roomNeedsBotWork(room) {
  if (!room.game || room.paused || room.game.state.roundOver) return false;
  if (room.game.state.pendingDraw) {
    const responder = getCurrentDrawResponder(room.game.state);
    return responder !== null && isBotSeat(room.seats[responder]);
  }
  return isBotSeat(room.seats[room.game.state.currentPlayerIndex]);
}

function scheduleBotWork(room, delayMs) {
  if (!roomNeedsBotWork(room) || room.botTimer || room.botBusy) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    runBotWork(room);
  }, delayMs || BOT_ACTION_DELAY_MS);
}

function runBotWork(room) {
  if (room.botBusy) return;
  if (!roomNeedsBotWork(room)) return;
  room.botBusy = true;

  try {
    let result;
    if (room.game.state.pendingDraw) {
      const responder = getCurrentDrawResponder(room.game.state);
      if (responder !== null && isBotSeat(room.seats[responder])) {
        const response = TongitsAI.answerDraw(room.game, responder);
        result = room.game.respondToDraw(responder, response);
      }
    } else {
      const playerIndex = room.game.state.currentPlayerIndex;
      if (isBotSeat(room.seats[playerIndex])) {
        result = TongitsAI.playTurn(room.game, playerIndex);
      }
    }

    if (result && !result.ok) {
      room.paused = true;
      room.pauseReason = "A bot could not complete its turn. Please restart the room from the admin page.";
    }

    emitToRoom(room);
  } finally {
    room.botBusy = false;
  }

  if (roomNeedsBotWork(room)) {
    scheduleBotWork(room, room.game && room.game.state.pendingDraw ? BOT_RESPONSE_DELAY_MS : BOT_ACTION_DELAY_MS);
  }
}

function joinSocketToSeat(socket, room, seatIndex, token, name) {
  const seat = room.seats[seatIndex];
  seat.token = token;
  seat.name = normalizeName(name);
  seat.connected = true;
  seat.socketId = socket.id;
  if (!room.hostToken) room.hostToken = token;
  socket.join(room.code);
  addSocketIndex(socket, room.code, seat.token);
  room.paused = room.game ? readyHumanSeatsCount(room) !== humanSeatCount(room) : false;
  room.pauseReason = room.paused ? "Waiting for every human player to reconnect." : "";
}

function getRequiredDiscardMelds(game, playerIndex) {
  const requiredId = game.state.requiredDiscardCardId;
  if (!requiredId) return [];
  return game
    .getLegalMelds(playerIndex)
    .filter((meld) => meld.cards.some((card) => card.id === requiredId))
    .filter((meld) => meld.cards.filter((card) => card.id !== requiredId).length >= 2);
}

function startGame(room) {
  clearBotTimer(room);
  room.game = new TongitsLogic.TongitsGame({
    seed: Date.now(),
    playerConfigs: getPlayerConfigs(room)
  });
  room.paused = false;
  room.pauseReason = "";
  scheduleBotWork(room, BOT_ACTION_DELAY_MS);
}

function runAction(room, seatIndex, action) {
  const game = room.game;
  if (!game) return { ok: false, error: "The match has not started yet." };
  if (room.paused) return { ok: false, error: room.pauseReason || "The room is paused." };

  switch (action.type) {
    case "drawStock":
      return game.drawFromStock(seatIndex);
    case "takeDiscard": {
      const result = game.drawFromDiscard(seatIndex);
      if (!result.ok) return result;
      const forced = getRequiredDiscardMelds(game, seatIndex);
      if (forced.length === 1) {
        return game.exposeMeld(seatIndex, forced[0].cards.map((card) => card.id));
      }
      return result;
    }
    case "exposeMeld":
      return game.exposeMeld(seatIndex, action.cardIds || []);
    case "layOff":
      return game.layOff(seatIndex, action.cardId, Number(action.ownerIndex), action.meldId);
    case "discard":
      return game.discard(seatIndex, action.cardId);
    case "callTongits":
      return game.callTongits(seatIndex);
    case "callDraw":
      return game.callDraw(seatIndex);
    case "drawResponse":
      return game.respondToDraw(seatIndex, action.response);
    default:
      return { ok: false, error: "Unknown action." };
  }
}

function getAdminToken(req) {
  const bearer = String(req.get("authorization") || "");
  if (bearer.startsWith("Bearer ")) return bearer.slice(7).trim();
  return String(req.get("x-admin-token") || "").trim();
}

function requireAdmin(req, res, next) {
  const token = getAdminToken(req);
  const session = token ? adminSessions.get(token) : null;
  if (!session) {
    return res.status(401).json({ ok: false, error: "Admin login required." });
  }
  session.lastUsedAt = Date.now();
  next();
}

app.post("/api/admin/login", (req, res) => {
  const password = req.body && req.body.password;
  if (!compareSecret(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ ok: false, error: "Incorrect admin password." });
  }
  const token = crypto.randomUUID();
  adminSessions.set(token, {
    createdAt: Date.now(),
    lastUsedAt: Date.now()
  });
  return res.json({ ok: true, token });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  adminSessions.delete(getAdminToken(req));
  res.json({ ok: true });
});

app.get("/api/admin/rooms", requireAdmin, (_req, res) => {
  const payload = Array.from(rooms.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map(buildAdminRoomSnapshot);
  res.json({ ok: true, rooms: payload });
});

app.post("/api/admin/rooms", requireAdmin, (req, res) => {
  const room = makeRoom(req.body || {});
  rooms.set(room.code, room);
  res.json({ ok: true, room: buildAdminRoomSnapshot(room) });
});

app.delete("/api/admin/rooms/:code", requireAdmin, (req, res) => {
  const roomCode = normalizeRoomCode(req.params.code);
  const room = rooms.get(roomCode);
  if (!room) return res.status(404).json({ ok: false, error: "Room not found." });
  closeRoom(room, `Room ${roomCode} was removed by the admin.`);
  return res.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("lobby:create", (_payload, reply) => {
    return reply({ ok: false, error: "Rooms can be created only from the admin page." });
  });

  socket.on("lobby:join", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String((payload && payload.token) || "").trim();
    if (!roomCode || !token) return reply({ ok: false, error: "Room code and token are required." });

    const room = rooms.get(roomCode);
    if (!room) return reply({ ok: false, error: "Room not found." });
    if (room.game) return reply({ ok: false, error: "That room has already started." });

    const existingSeatIndex = getSeatIndexByToken(room, token);
    if (existingSeatIndex >= 0) {
      joinSocketToSeat(socket, room, existingSeatIndex, token, payload.name);
      emitToRoom(room);
      return reply({ ok: true, roomCode });
    }

    const seatIndex = findFirstOpenHumanSeat(room);
    if (seatIndex < 0) return reply({ ok: false, error: "No open human seats remain in that room." });

    joinSocketToSeat(socket, room, seatIndex, token, payload.name);
    emitToRoom(room);
    return reply({ ok: true, roomCode });
  });

  socket.on("lobby:resume", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String((payload && payload.token) || "").trim();
    const room = rooms.get(roomCode);
    if (!room || !token) return reply({ ok: false, error: "Unable to resume that room." });
    if (!room.game && !room.seats.some((seat) => isHumanSeat(seat) && seat.token === token)) {
      return reply({ ok: false, error: "Seat not found in that room." });
    }
    const seatIndex = getSeatIndexByToken(room, token);
    if (seatIndex < 0) return reply({ ok: false, error: "Seat not found in that room." });
    joinSocketToSeat(socket, room, seatIndex, token, room.seats[seatIndex].name);
    emitToRoom(room);
    scheduleBotWork(room, BOT_RESPONSE_DELAY_MS);
    return reply({ ok: true, roomCode });
  });

  socket.on("lobby:start", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String((payload && payload.token) || "").trim();
    const room = rooms.get(roomCode);
    if (!room) return reply({ ok: false, error: "Room not found." });
    if (token !== room.hostToken) return reply({ ok: false, error: "Only the host can start the match." });
    if (room.game) return reply({ ok: false, error: "The match has already started." });
    if (!canStartRoom(room)) return reply({ ok: false, error: "All required human seats must be connected before start." });

    startGame(room);
    emitToRoom(room);
    return reply({ ok: true });
  });

  socket.on("room:nextRound", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String((payload && payload.token) || "").trim();
    const room = rooms.get(roomCode);
    if (!room || !room.game) return reply({ ok: false, error: "No active match found." });
    if (token !== room.hostToken) return reply({ ok: false, error: "Only the host can start the next round." });
    if (!room.game.state.roundOver) return reply({ ok: false, error: "The current round is still in progress." });

    clearBotTimer(room);
    room.game.newRound();
    room.paused = readyHumanSeatsCount(room) !== humanSeatCount(room);
    room.pauseReason = room.paused ? "Waiting for every human player to reconnect." : "";
    emitToRoom(room);
    scheduleBotWork(room, BOT_ACTION_DELAY_MS);
    return reply({ ok: true });
  });

  socket.on("lobby:leave", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String((payload && payload.token) || "").trim();
    const room = rooms.get(roomCode);
    if (!room) return reply({ ok: true });

    const seatIndex = getSeatIndexByToken(room, token);
    if (seatIndex < 0) return reply({ ok: true });

    if (room.game) {
      closeRoom(room, `${room.seats[seatIndex].name} left the match, so the room was closed.`);
      return reply({ ok: true, closed: true });
    }

    const seat = room.seats[seatIndex];
    clearHumanSeat(seat);
    ensureHost(room);
    removeSocketIndex(socket.id);
    socket.leave(room.code);
    emitToRoom(room);
    return reply({ ok: true });
  });

  socket.on("game:action", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String((payload && payload.token) || "").trim();
    const room = rooms.get(roomCode);
    if (!room || !room.game) return reply({ ok: false, error: "No active match found." });

    const seatIndex = getSeatIndexByToken(room, token);
    if (seatIndex < 0) return reply({ ok: false, error: "You are not seated in that room." });

    const result = runAction(room, seatIndex, payload.action || {});
    emitToRoom(room);
    if (result.ok) scheduleBotWork(room, room.game && room.game.state.pendingDraw ? BOT_RESPONSE_DELAY_MS : BOT_ACTION_DELAY_MS);
    return reply(result);
  });

  socket.on("disconnect", () => {
    const binding = socketIndex.get(socket.id);
    if (!binding) return;

    removeSocketIndex(socket.id);
    const room = rooms.get(binding.roomCode);
    if (!room) return;

    const seatIndex = getSeatIndexByToken(room, binding.token);
    if (seatIndex < 0) return;

    const seat = room.seats[seatIndex];
    if (!seat || !isHumanSeat(seat)) return;

    if (room.game) {
      seat.connected = false;
      seat.socketId = null;
      room.paused = true;
      room.pauseReason = `${seat.name} disconnected. Waiting for reconnection.`;
      clearBotTimer(room);
      emitToRoom(room);
      return;
    }

    clearHumanSeat(seat);
    ensureHost(room);
    emitToRoom(room);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Tongits multiplayer server listening on http://0.0.0.0:${PORT}`);
});
