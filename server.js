// Author: Mark Daniel G. Dacer

"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const TongitsLogic = require("./game-logic");

const PORT = Number(process.env.PORT || 3000);
const ROOM_SIZE = 3;
const ROOM_CODE_LENGTH = 6;

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, now: new Date().toISOString() });
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

const rooms = new Map();
const socketIndex = new Map();

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

function makeSeat(token, name, socketId) {
  return {
    token,
    name: normalizeName(name),
    socketId,
    connected: true
  };
}

function getHostSeatIndex(room) {
  return room.seats.findIndex((seat) => seat && seat.token === room.hostToken);
}

function ensureHost(room) {
  if (room.hostToken && room.seats.some((seat) => seat && seat.token === room.hostToken)) return;
  const nextSeat = room.seats.find((seat) => seat);
  room.hostToken = nextSeat ? nextSeat.token : null;
}

function getSeatIndexByToken(room, token) {
  return room.seats.findIndex((seat) => seat && seat.token === token);
}

function roomSeatCount(room) {
  return room.seats.filter(Boolean).length;
}

function allSeatsConnected(room) {
  return room.seats.every((seat) => seat && seat.connected);
}

function getPlayerConfigs(room) {
  return room.seats.map((seat, index) => ({
    id: `room-${room.code}-seat-${index + 1}`,
    name: seat ? seat.name : `Seat ${index + 1}`,
    isBot: false,
    difficulty: "human"
  }));
}

function getCurrentDrawResponder(state) {
  const pending = state.pendingDraw;
  if (!pending) return null;
  if (pending.position >= pending.responderOrder.length) return null;
  return pending.responderOrder[pending.position];
}

function sanitizePlayer(player, viewerSeatIndex, revealHands) {
  return {
    id: player.id,
    index: player.index,
    name: player.name,
    isBot: player.isBot,
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
  const mySeatIndex = getSeatIndexByToken(room, viewerToken);
  const hostSeatIndex = getHostSeatIndex(room);
  return {
    room: {
      code: room.code,
      started: Boolean(room.game),
      paused: room.paused,
      pauseReason: room.pauseReason,
      mySeatIndex,
      hostSeatIndex,
      isHost: mySeatIndex === hostSeatIndex,
      canStart: !room.game && roomSeatCount(room) === ROOM_SIZE && allSeatsConnected(room),
      seats: room.seats.map((seat, index) => ({
        index,
        name: seat ? seat.name : `Open seat ${index + 1}`,
        connected: seat ? seat.connected : false,
        occupied: Boolean(seat)
      }))
    },
    game: room.game
      ? {
          state: sanitizeState(room.game, mySeatIndex),
          log: room.game.log.slice()
        }
      : null
  };
}

function emitToRoom(room) {
  room.seats.forEach((seat) => {
    if (!seat || !seat.socketId) return;
    io.to(seat.socketId).emit("room:update", buildSnapshot(room, seat.token));
  });
}

function closeRoom(room, message) {
  room.seats.forEach((seat) => {
    if (seat && seat.socketId) {
      io.to(seat.socketId).emit("room:closed", { message });
      socketIndex.delete(seat.socketId);
    }
  });
  rooms.delete(room.code);
}

function maybeDeleteEmptyRoom(room) {
  if (room.game) return;
  if (room.seats.every((seat) => !seat)) {
    rooms.delete(room.code);
  }
}

function addSocketIndex(socket, roomCode, token) {
  socketIndex.set(socket.id, { roomCode, token });
}

function removeSocketIndex(socketId) {
  socketIndex.delete(socketId);
}

function joinSocketToSeat(socket, room, seatIndex) {
  const seat = room.seats[seatIndex];
  seat.connected = true;
  seat.socketId = socket.id;
  socket.join(room.code);
  addSocketIndex(socket, room.code, seat.token);
  room.paused = room.game ? !allSeatsConnected(room) : false;
  room.pauseReason = room.paused ? "Waiting for every player to reconnect." : "";
}

function findFirstOpenSeat(room) {
  return room.seats.findIndex((seat) => !seat);
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
  room.game = new TongitsLogic.TongitsGame({
    seed: Date.now(),
    playerConfigs: getPlayerConfigs(room)
  });
  room.paused = false;
  room.pauseReason = "";
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

io.on("connection", (socket) => {
  socket.on("lobby:create", (payload, reply) => {
    const token = String(payload && payload.token || "").trim();
    if (!token) return reply({ ok: false, error: "Missing player token." });

    const roomCode = createUniqueRoomCode();
    const room = {
      code: roomCode,
      hostToken: token,
      seats: [makeSeat(token, payload.name, socket.id), null, null],
      game: null,
      paused: false,
      pauseReason: ""
    };
    rooms.set(roomCode, room);
    socket.join(roomCode);
    addSocketIndex(socket, roomCode, token);
    emitToRoom(room);
    return reply({ ok: true, roomCode });
  });

  socket.on("lobby:join", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String(payload && payload.token || "").trim();
    if (!roomCode || !token) return reply({ ok: false, error: "Room code and token are required." });

    const room = rooms.get(roomCode);
    if (!room) return reply({ ok: false, error: "Room not found." });
    if (room.game) return reply({ ok: false, error: "That room has already started." });

    const existingSeatIndex = getSeatIndexByToken(room, token);
    if (existingSeatIndex >= 0) {
      room.seats[existingSeatIndex].name = normalizeName(payload.name);
      joinSocketToSeat(socket, room, existingSeatIndex);
      emitToRoom(room);
      return reply({ ok: true, roomCode });
    }

    const seatIndex = findFirstOpenSeat(room);
    if (seatIndex < 0) return reply({ ok: false, error: "That room is full." });

    room.seats[seatIndex] = makeSeat(token, payload.name, socket.id);
    joinSocketToSeat(socket, room, seatIndex);
    emitToRoom(room);
    return reply({ ok: true, roomCode });
  });

  socket.on("lobby:resume", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String(payload && payload.token || "").trim();
    const room = rooms.get(roomCode);
    if (!room || !token) return reply({ ok: false, error: "Unable to resume that room." });
    const seatIndex = getSeatIndexByToken(room, token);
    if (seatIndex < 0) return reply({ ok: false, error: "Seat not found in that room." });
    joinSocketToSeat(socket, room, seatIndex);
    emitToRoom(room);
    return reply({ ok: true, roomCode });
  });

  socket.on("lobby:start", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String(payload && payload.token || "").trim();
    const room = rooms.get(roomCode);
    if (!room) return reply({ ok: false, error: "Room not found." });
    if (token !== room.hostToken) return reply({ ok: false, error: "Only the host can start the match." });
    if (room.game) return reply({ ok: false, error: "The match has already started." });
    if (roomSeatCount(room) !== ROOM_SIZE) return reply({ ok: false, error: "You need exactly 3 players to start." });
    if (!allSeatsConnected(room)) return reply({ ok: false, error: "All players must be connected to start." });

    startGame(room);
    emitToRoom(room);
    return reply({ ok: true });
  });

  socket.on("room:nextRound", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String(payload && payload.token || "").trim();
    const room = rooms.get(roomCode);
    if (!room || !room.game) return reply({ ok: false, error: "No active match found." });
    if (token !== room.hostToken) return reply({ ok: false, error: "Only the host can start the next round." });
    if (!room.game.state.roundOver) return reply({ ok: false, error: "The current round is still in progress." });

    room.game.newRound();
    room.paused = !allSeatsConnected(room);
    room.pauseReason = room.paused ? "Waiting for every player to reconnect." : "";
    emitToRoom(room);
    return reply({ ok: true });
  });

  socket.on("lobby:leave", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String(payload && payload.token || "").trim();
    const room = rooms.get(roomCode);
    if (!room) return reply({ ok: true });

    const seatIndex = getSeatIndexByToken(room, token);
    if (seatIndex < 0) return reply({ ok: true });

    if (room.game) {
      closeRoom(room, `${room.seats[seatIndex].name} left the match, so the room was closed.`);
      return reply({ ok: true, closed: true });
    }

    room.seats[seatIndex] = null;
    ensureHost(room);
    removeSocketIndex(socket.id);
    socket.leave(room.code);
    emitToRoom(room);
    maybeDeleteEmptyRoom(room);
    return reply({ ok: true });
  });

  socket.on("game:action", (payload, reply) => {
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const token = String(payload && payload.token || "").trim();
    const room = rooms.get(roomCode);
    if (!room || !room.game) return reply({ ok: false, error: "No active match found." });

    const seatIndex = getSeatIndexByToken(room, token);
    if (seatIndex < 0) return reply({ ok: false, error: "You are not seated in that room." });

    const result = runAction(room, seatIndex, payload.action || {});
    emitToRoom(room);
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
    if (!seat) return;

    if (room.game) {
      seat.connected = false;
      seat.socketId = null;
      room.paused = true;
      room.pauseReason = `${seat.name} disconnected. Waiting for reconnection.`;
      emitToRoom(room);
      return;
    }

    room.seats[seatIndex] = null;
    ensureHost(room);
    maybeDeleteEmptyRoom(room);
    if (rooms.has(room.code)) emitToRoom(room);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Tongits multiplayer server listening on http://0.0.0.0:${PORT}`);
});
