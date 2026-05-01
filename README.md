# Dacer's Tongits Table

Author: Mark Daniel G. Dacer

Dacer's Tongits Table is a browser-based 3-player Tongits multiplayer app with an admin-managed room system. The UI runs in the browser, while the match state is enforced by an authoritative Node.js + Socket.IO server.

## Quick Start

1. Open the project folder:

   ```text
   D:\TONGITS
   ```

2. Install dependencies:

   ```powershell
   npm install
   ```

3. Start the multiplayer server:

   ```powershell
   npm start
   ```

4. Open the app in a browser:

   ```text
   http://localhost:3000
   ```

5. Open the admin page:

   ```text
   http://localhost:3000/admin
   ```

6. Log in to the admin page.

   Default password:

   ```text
   Dacer_2026!
   ```

7. Create a room with one of these setups:
   - `1 human + 2 bots`
   - `2 humans + 1 bot`
   - `3 humans`

8. Open the main game page:

   ```text
   http://localhost:3000
   ```

9. In the player app:
   - Enter a player name.
   - Make sure the `Server URL` points at the same app address.
   - Pick a room from the live room list, or enter the room code created by the admin.
   - Click `Join Room`.
   - Ready rules:
     - `1 human + 2 bots`: starts immediately after the human joins
     - `2 humans + 1 bot`: both humans must click `Ready Up`, then the app starts a 5-second countdown
     - `3 humans`: all three humans must click `Ready Up`, then the app starts a 5-second countdown

For local testing, you can open the app in three tabs or three browser windows. Each tab now keeps its own player seat token, so one browser can simulate all 3 players.

## Multiplayer Setup

- `Frontend`: browser UI in `index.html`, `style.css`, `main.js`
- `Backend`: `server.js` on Node/Express
- `Realtime sync`: Socket.IO
- `Rules engine`: `game-logic.js`, shared by both client helpers and server authority
- `Admin console`: `admin.html`, `admin.css`, `admin.js`
- `Bot strategy`: `ai.js`, now used by the server for bot seats

The server is authoritative. Clients send actions such as draw, discard, meld, sapaw, Draw, Fold, and Challenge. The server validates the move and broadcasts the updated room state.

## Deployment

### Netlify + Render

Recommended production split:

- `Netlify`: host the frontend files
- `Render`: run `server.js`

Set the backend URL in one of these ways:

1. Enter the Render URL in the in-app `Server URL` field, or
2. Edit `config.js` and set `window.TONGITS_CONFIG.serverUrl`

Example:

```js
window.TONGITS_CONFIG = {
  serverUrl: "https://your-render-service.onrender.com"
};
```

### Local Single-Server Mode

By default, `server.js` also serves the frontend files, so `npm start` is enough for local play.

If you want the server to run as backend-only, set:

```powershell
$env:SERVE_STATIC = "0"
npm start
```

## Project Files

```text
D:\TONGITS
|-- index.html
|-- style.css
|-- config.js
|-- main.js
|-- admin.html
|-- admin.css
|-- admin.js
|-- game-logic.js
|-- server.js
|-- package.json
|-- package-lock.json
|-- ai.js
|-- README.md
`-- assets
    |-- card-back.svg
    |-- table-felt.svg
    `-- README.md
```

Notes:

- `ai.js` is used by the server whenever a room includes bot seats.
- `game-logic.js` is written so it can be used in both the browser and Node.js.
- The admin password defaults to `Dacer_2026!`, but you can override it with the `ADMIN_PASSWORD` environment variable.

## Controls

### Lobby

- `Player Name`: your display name in the room
- `Server URL`: where the Socket.IO game server is running
- `Room Code`: the 6-character room code
- `Game Rooms`: live room browser that lists admin-created rooms, seat usage, ready count, and countdown state
- `Join Room`: join an existing lobby
- `Leave Room`: leave the current lobby or match
- `Ready Up` / `Unready`: marks your seat ready before auto-start in 2-player and 3-player rooms
- `Next Round`: host-only button shown after round end

### Admin Page

- `Admin Login`: unlocks room creation and monitoring
- `Human Players`: chooses whether the room is for 1, 2, or 3 human players
- `Bot Difficulty`: sets the difficulty for any bot seats in that room
- `Create Room`: creates a new room and room code
- `Refresh`: reloads room monitoring data
- `Remove Room`: force-closes a room for any connected players

### Match Actions

- `Draw Stock`: draw one card from the stock when legal
- `Take Discard`: take the top discard only when it can form a required exposed meld
- `Lay Meld`: expose the selected legal set or run
- `Discard`: discard one selected card to end your turn
- `Tongits`: call Tongits when your hand is empty or fully groupable into legal melds
- `Call Draw`: call Draw at the start of your turn when eligible
- `Challenge` / `Fold`: respond to a Draw call
- `Sort Hand`: return to normal sorted hand view and turn auto grouping off
- `Auto Group`: toggle private hidden meld/deadwood grouping
- `Rules`: open the in-app rules panel

You can click cards to select them. You can also drag a selected card to the discard pile or onto an exposed meld for legal sapaw.

## Match Flow

1. An admin creates a room.
2. Players join from the live room browser or with a shared room code.
3. The room starts using the configured lobby rule:
   - `1 human + 2 bots`: immediate start
   - `2 humans + 1 bot`: both humans ready, then 5-second countdown
   - `3 humans`: all humans ready, then 5-second countdown
4. The server deals 13 cards to the dealer and 12 to the other two players.
5. If the room uses bots, the remaining seats are filled by server-side bot players.
6. Players take turns drawing, melding, sapaw, discarding, and calling endgame actions when legal.
7. The server resolves bot turns, Tongits, Draw, stock exhaustion, scoring, and burn/sunog.
8. After the round summary, the host can start the next round.

If a player disconnects during an active match, the room pauses until that player reconnects. If a player disconnects in the lobby before the match starts, the seat is released so someone else can join. If the last human leaves a lobby room, that room closes immediately.

## Rules Implemented

This app follows a Pagat-style strict-open Tongits ruleset:

- 3 players use a standard 52-card deck.
- Dealer receives 13 cards; the other players receive 12.
- Aces are low only.
- Legal melds are:
  - Set: 3 or 4 cards of the same rank
  - Run: 3 or more consecutive cards of the same suit
- Sapaw allows adding legal cards to exposed melds.
- A discard pickup must immediately create a new meld with the picked discard and at least two cards from hand.
- A discard pickup cannot remain hidden in hand.
- A discard pickup cannot be used only for sapaw.
- Draw can be called only at the start of your turn after you have exposed at least one own meld.
- Burned or sunog players cannot win stock-exhaustion low-point comparison.

## Discard Pickup Rule

If you take a card from the discard pile, the app forces that card into an exposed field meld:

- If there is only one legal meld, it is exposed automatically.
- If there are multiple legal melds, the app shows a required choice.
- You cannot continue the turn until that required meld is exposed.

## Burn / Sunog

A player is marked sunog or burned if the round ends and they never exposed a valid own meld.

In this app:

- Burned players cannot challenge a Draw.
- Burned players cannot win low-point comparison when the stock runs out.
- Burned losing players receive a visible `+10` burn penalty in the round summary.

## Scoring

Deadwood points:

- Ace: 1
- 2 to 9: face value
- 10, J, Q, K: 10

The app compares the lowest possible deadwood after grouping hidden hand melds. Hidden hand groupings help calculate points, but they do not count as opened melds and do not protect from sunog until exposed.

## Visual And Audio Notes

- Sound effects are generated with the browser Web Audio API.
- Lobby and match sound cues include room join, ready, unready, countdown start, countdown ticks, match start, room closed, and the existing gameplay actions.
- Background table music now uses the bundled track `Smooth Like Jazz` by Ahjay Stelino from Mixkit and can be toggled with `Music: On/Off`.
- Action-specific animations are triggered from game events in `main.js`.
- The card graphics can be switched between `Classic` and `Dark`.

## Verification

The multiplayer conversion was smoke-tested locally for:

- admin login
- admin room creation
- live room list broadcast to connected clients
- room join
- immediate start for `1 human + 2 bots`
- ready gating and 5-second countdown for `2 humans + 1 bot`
- ready gating and 5-second countdown for `3 humans`
- lobby room auto-close when the last human leaves
- bot turn progression after a human action
- turn state broadcast after a legal action
- disconnect pause during an active match
- reconnect resume into the same seat
