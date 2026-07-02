# 🎮 GameCam

Video chat with strangers around the world — and battle them in quick games.
No sign-up, no accounts. Hop on, get matched, say hi, pick a game, play, skip, repeat.

Think Omegle / Monkey, but the icebreaker is a gamebox: quick competitive rounds
so you can meet lots of people a night — or send a private link to a long-distance
friend and hang out.

## Features (MVP)

- 🎥 **Instant video + voice chat** — WebRTC, peer-to-peer, no login
- 🔀 **Random matchmaking** with a **Skip** button (auto-requeues you)
- 🔗 **Play with a friend** — share a unique invite link, connect instantly
- 🎮 **Gamebox** — challenge your match; they have to accept before it starts:
  - ❌⭕ **Tic-Tac-Toe** — 30-second rounds
  - 🔴🟡 **Connect 4** — drop discs, talk trash
  - 🟩🟨 **Wordle Race** — same word, first to crack it wins (you see their progress as colors only)
- 💬 **Text chat** alongside the call
- 🏆 **Per-match scoreboard** and instant rematch
- 🎙️ Mic / 📷 camera toggles

## Run it

```bash
npm install
npm start
# open http://localhost:3000 in two browser tabs/windows to try it solo
```

Requires Node 18+. No build step, no database — one process serves the static
frontend and a WebSocket endpoint (`/ws`) that handles matchmaking, WebRTC
signaling, chat relay and game-move relay. Game logic runs in the browsers;
the server never stores anything.

> **Note:** browsers require HTTPS for camera access on anything other than
> `localhost`, so deploy behind TLS (every platform below does this for you).

## Deploy

Works out of the box on Render, Railway, Fly.io, Heroku or any Node host:
the server binds `process.env.PORT` and serves everything from one port.

For users behind strict NATs you'll eventually want a TURN server (e.g.
[coturn](https://github.com/coturn/coturn) or a hosted service) added to
`RTC_CONFIG` in `public/js/rtc.js` — STUN-only covers most, not all, networks.

## How a match works

1. Client connects to `/ws` and sends `find` (or `join_room` from an invite link)
2. Server pairs two sockets and tells one to be the WebRTC *caller*
3. Clients exchange SDP/ICE through the server, video goes peer-to-peer
4. Either player opens the gamebox and sends a `game_invite`
5. The other player accepts → server picks a shared seed + who goes first → both clients launch the game
6. Moves are relayed as opaque `game_move` messages; game rules run client-side
7. Skip ends the pairing and both players can requeue instantly

## Adding a game

Games are tiny self-contained modules in `public/js/games/`. Implement:

```js
export function create(container, ctx) {
  // ctx.first    -> true if you move first
  // ctx.seed     -> shared random seed (same for both players)
  // ctx.sendMove(data)   -> send a move to the opponent
  // ctx.setTurn(bool|null) -> update the "Your turn" pill (null hides it)
  // ctx.finish('win'|'lose'|'draw') -> end the game
  return {
    onMove(data) { /* opponent moved */ },
    destroy() { /* remove your DOM */ },
  };
}
```

…and register it in `public/js/games/registry.js`. That's it.

## Roadmap ideas

- More games: chess, 8-ball pool, tanks, quick trivia
- Round timers to keep the speed format honest
- Co-op parties / duos matchmaking
- Report/block + basic moderation before any public launch
- TURN server for restrictive networks
- Ads or cosmetics for revenue (later, maybe)

## License

MIT
