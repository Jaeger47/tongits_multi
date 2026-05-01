// Author: Mark Daniel G. Dacer

(function () {
  "use strict";

  const POLL_MS = 3000;
  const TOKEN_KEY = "tongitsAdminToken";
  const els = {};
  let adminToken = localStorage.getItem(TOKEN_KEY) || "";
  let pollTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "admin-login-view",
      "admin-dashboard",
      "admin-login-form",
      "admin-password-input",
      "admin-login-btn",
      "logout-btn",
      "refresh-btn",
      "human-players-select",
      "bot-difficulty-select",
      "create-room-btn",
      "admin-stats",
      "last-updated",
      "admin-status",
      "room-list"
    ].forEach((id) => {
      els[id] = $(id);
    });
  }

  function setStatus(message, isError) {
    els["admin-status"].textContent = message || "";
    els["admin-status"].className = isError ? "status-line error" : "status-line";
  }

  function titleCase(value) {
    const text = String(value || "");
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  async function api(path, options) {
    const settings = Object.assign({
      method: "GET",
      headers: {}
    }, options || {});

    settings.headers = Object.assign({}, settings.headers);
    if (adminToken) settings.headers.Authorization = `Bearer ${adminToken}`;
    if (settings.body && !settings.headers["Content-Type"]) {
      settings.headers["Content-Type"] = "application/json";
    }

    const response = await fetch(path, settings);
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      adminToken = "";
      localStorage.removeItem(TOKEN_KEY);
      stopPolling();
      showLogin();
      throw new Error(data.error || "Admin session expired.");
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      loadRooms().catch(() => {});
    }, POLL_MS);
  }

  function showLogin() {
    els["admin-login-view"].hidden = false;
    els["admin-dashboard"].hidden = true;
  }

  function showDashboard() {
    els["admin-login-view"].hidden = true;
    els["admin-dashboard"].hidden = false;
  }

  function renderStats(rooms) {
    const liveRooms = rooms.filter((room) => room.started && !room.roundOver).length;
    const pausedRooms = rooms.filter((room) => room.paused).length;
    const totalHumans = rooms.reduce((sum, room) => sum + room.joinedHumanPlayers, 0);
    const totalBots = rooms.reduce((sum, room) => sum + room.botPlayers, 0);

    els["admin-stats"].innerHTML = [
      { label: "Rooms", value: rooms.length },
      { label: "Live Matches", value: liveRooms },
      { label: "Paused Rooms", value: pausedRooms },
      { label: "Joined Humans", value: totalHumans },
      { label: "Bot Seats", value: totalBots }
    ]
      .map((item) => `<div class="stat-card"><span>${item.label}</span><strong>${item.value}</strong></div>`)
      .join("");
  }

  function roomStatus(room) {
    if (room.countdownSecondsLeft) return `Starting in ${room.countdownSecondsLeft}`;
    if (!room.started) return room.canStart ? "Ready to start" : "Waiting in lobby";
    if (room.paused) return "Paused";
    if (room.roundOver) return "Round over";
    return "In match";
  }

  function seatSummary(seat) {
    if (seat.type === "bot") return `Bot - ${titleCase(seat.difficulty)}`;
    if (!seat.occupied) return "Waiting for player";
    return seat.connected ? "Connected" : "Disconnected";
  }

  function renderRooms(rooms) {
    if (!rooms.length) {
      els["room-list"].innerHTML = '<div class="room-card"><p>No rooms yet. Create the first table above.</p></div>';
      return;
    }

    els["room-list"].innerHTML = rooms
      .map((room) => {
        const tags = [
          `<span class="tag">${room.humanPlayers} human</span>`,
          `<span class="tag">${room.botPlayers} bot</span>`,
          room.started ? `<span class="tag live">${room.phase || "Live"}</span>` : '<span class="tag">Lobby</span>',
          room.paused ? '<span class="tag pause">Paused</span>' : "",
          room.canStart ? '<span class="tag live">Ready</span>' : "",
          room.countdownSecondsLeft ? `<span class="tag live">${room.countdownSecondsLeft}s</span>` : ""
        ].filter(Boolean).join("");

        const seats = room.seats
          .map((seat) => `<article class="seat-card ${seat.type === "bot" ? "bot" : ""}">
            <h4>Seat ${seat.index + 1}</h4>
            <p>${escapeHtml(seat.name)}</p>
            <p>${escapeHtml(seatSummary(seat))}</p>
            <p>${seat.handCount === null ? "" : `Hand ${seat.handCount} | Score ${seat.score}`}</p>
          </article>`)
          .join("");

        const logs = room.logTail.length
          ? `<div class="log-tail">${room.logTail.map((entry) => `<div><strong>${escapeHtml(entry.time)}</strong> ${escapeHtml(entry.text)}</div>`).join("")}</div>`
          : "";

        return `<section class="room-card" data-room-code="${room.code}">
          <div class="room-card-head">
            <div>
              <h3>Room ${escapeHtml(room.code)}</h3>
              <p>${escapeHtml(roomStatus(room))}</p>
            </div>
            <div class="tag-row">${tags}</div>
          </div>
          <div class="room-meta">
            <span class="tag">Host: ${escapeHtml(room.hostName || "Waiting")}</span>
            <span class="tag">Humans ready: ${room.readyHumanPlayers}/${room.humanPlayers}</span>
            <span class="tag">Turn: ${escapeHtml(room.currentTurnName || "-")}</span>
            <span class="tag">Created: ${escapeHtml(new Date(room.createdAt).toLocaleString())}</span>
          </div>
          <div class="seat-grid">${seats}</div>
          ${room.pauseReason ? `<p class="status-line error">${escapeHtml(room.pauseReason)}</p>` : ""}
          ${logs}
          <div class="room-actions">
            <button class="copy-room-btn" type="button" data-room-code="${room.code}">Copy Room Code</button>
            <button class="remove-room-btn" type="button" data-room-code="${room.code}">Remove Room</button>
          </div>
        </section>`;
      })
      .join("");

    document.querySelectorAll(".copy-room-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const code = button.dataset.roomCode;
        try {
          await navigator.clipboard.writeText(code);
          setStatus(`Copied room code ${code}.`);
        } catch (_error) {
          setStatus(`Room code: ${code}`);
        }
      });
    });

    document.querySelectorAll(".remove-room-btn").forEach((button) => {
      button.addEventListener("click", () => {
        removeRoom(button.dataset.roomCode);
      });
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  async function loadRooms() {
    const data = await api("/api/admin/rooms");
    renderStats(data.rooms);
    renderRooms(data.rooms);
    els["last-updated"].textContent = `Updated ${new Date().toLocaleTimeString()}`;
    setStatus(`Loaded ${data.rooms.length} room${data.rooms.length === 1 ? "" : "s"}.`);
  }

  async function login(event) {
    event.preventDefault();
    els["admin-login-btn"].disabled = true;
    setStatus("");
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          password: els["admin-password-input"].value
        })
      });
      adminToken = data.token;
      localStorage.setItem(TOKEN_KEY, adminToken);
      els["admin-password-input"].value = "";
      showDashboard();
      await loadRooms();
      startPolling();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      els["admin-login-btn"].disabled = false;
    }
  }

  async function logout() {
    try {
      if (adminToken) {
        await api("/api/admin/logout", { method: "POST" });
      }
    } catch (_error) {
      // Ignore logout errors and clear local session anyway.
    }
    adminToken = "";
    localStorage.removeItem(TOKEN_KEY);
    stopPolling();
    showLogin();
    setStatus("Logged out.");
  }

  async function createRoom() {
    els["create-room-btn"].disabled = true;
    try {
      const data = await api("/api/admin/rooms", {
        method: "POST",
        body: JSON.stringify({
          humanPlayers: Number(els["human-players-select"].value),
          botDifficulty: els["bot-difficulty-select"].value
        })
      });
      setStatus(`Created room ${data.room.code}.`);
      await loadRooms();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      els["create-room-btn"].disabled = false;
    }
  }

  async function removeRoom(code) {
    if (!window.confirm(`Remove room ${code}? This closes it for any connected players.`)) return;
    try {
      await api(`/api/admin/rooms/${encodeURIComponent(code)}`, {
        method: "DELETE"
      });
      setStatus(`Removed room ${code}.`);
      await loadRooms();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function bindEvents() {
    els["admin-login-form"].addEventListener("submit", login);
    els["logout-btn"].addEventListener("click", logout);
    els["refresh-btn"].addEventListener("click", () => {
      loadRooms().catch((error) => setStatus(error.message, true));
    });
    els["create-room-btn"].addEventListener("click", createRoom);
  }

  async function init() {
    cacheEls();
    bindEvents();

    if (!adminToken) {
      showLogin();
      return;
    }

    try {
      showDashboard();
      await loadRooms();
      startPolling();
    } catch (_error) {
      showLogin();
    }
  }

  init();
})();
