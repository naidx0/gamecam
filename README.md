# 🎮 GameCam

Video chat with strangers around the world — and battle them in quick games.
No sign-up, no accounts. Hop on, get matched, say hi, pick a game, play, skip, repeat.

Think Omegle / Monkey, but the icebreaker is a gamebox: quick competitive rounds
so you can meet lots of people a night — or send a private link to a long-distance
friend and hang out.

## Features (MVP)

- 🎥 **Instant video + voice chat** — WebRTC, peer-to-peer, no login
- 🔀 **Random matchmaking** with a **Skip** button (auto-requeues you)
- 🔗 **Play with a friend** — get a unique invite link; hitting **Copy** drops you
  straight into your room, where only that link can bring your friend in
- 🎮 **Gamebox** — challenge your match; they have to accept before it starts:
  - **8-Ball Pool** — top-down table, drag from the cue ball to aim, sink your
    group then the 8. Built from scratch (our own physics and art — the pool
    *mechanic* isn't copyrightable, only Miniclip's specific game is)
  - **Connect 4** — drop discs, talk trash
  - **Wordle Race** — same word, first to crack it wins (you see their progress as colors only)
- 💬 **Text chat** alongside the call
- ⏱️ **Fast turn timer** — 10 seconds to move (15 for a pool shot) or a random
  legal move is played for you, so rounds never drag
- 🏆 **Per-match scoreboard**, instant replay / new game / skip from the result screen
- 🎙️ Mic / camera toggles

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
A `render.yaml` (Render blueprint) and `Dockerfile` are included — on Render,
"New → Blueprint → point at this repo" is all it takes, then attach your
domain in the dashboard.

Vercel/Netlify-style serverless platforms won't work as-is: the app needs one
long-lived process for the WebSocket matchmaker.

For users behind strict NATs you'll eventually want a TURN server (e.g.
[coturn](https://github.com/coturn/coturn) or a hosted service) added to
`RTC_CONFIG` in `public/js/rtc.js` — STUN-only covers most, not all, networks.

## Safety & privacy

What's already safe by design:

- **All traffic is encrypted.** Signaling/chat/game moves ride HTTPS+WSS;
  the video call itself is WebRTC, which is always DTLS-SRTP encrypted.
  Nobody on the network path can read or watch anything.
- **Chat and game moves never go peer-to-peer** — they're relayed through the
  server, so they expose nothing about the other user.
- **Chat is rendered with `textContent`** (no HTML injection) and length-capped
  server-side.
- **Nothing is stored.** No accounts, no logs of conversations, no database.

The one real exposure — same as every WebRTC app (Omegle, Monkey, Zoom P2P):
**peer-to-peer video means each side's public IP appears in the connection
metadata** (ICE candidates). A technical user can read their own machine's
traffic and learn the opponent's IP — not your browsing data, passwords, or
"network information," just the IP, which roughly geolocates to a city. Modern
browsers already mask *local* addresses with mDNS.

To close even that before a big public launch, route media through a relay:

1. Run a TURN server (coturn) or use a hosted one (Twilio/Cloudflare/Metered)
2. Add it to `RTC_CONFIG` in `public/js/rtc.js` with credentials
3. Set `iceTransportPolicy: 'relay'` in the same config — peers then only ever
   see the relay's IP, never each other's

The trade-off is the relay's bandwidth bill, which is why "IP-hidden mode" is
the standard scale-up step rather than the MVP default.

Also worth doing before public launch: a report/block button and basic
rate limiting on matchmaking.

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

- More games: chess (MIT-licensed chess.js + our own board), tanks, quick trivia
- Round timers to keep the speed format honest
- Co-op parties / duos matchmaking (backlog)
- Report/block + basic moderation before any public launch
- TURN server for restrictive networks
- Ads or cosmetics for revenue (later, maybe)

## License

MIT
