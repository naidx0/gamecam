import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---- state ---------------------------------------------------------------
const queue = []; // sockets waiting for a random match
const rooms = new Map(); // friend-room code -> host socket waiting for a friend

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function removeFromQueue(ws) {
  const i = queue.indexOf(ws);
  if (i !== -1) queue.splice(i, 1);
}

function closeRoom(ws) {
  if (ws.roomCode) {
    rooms.delete(ws.roomCode);
    ws.roomCode = null;
  }
}

function unpair(ws, notifyPartner = true) {
  const partner = ws.partner;
  if (!partner) return;
  ws.partner = null;
  partner.partner = null;
  if (notifyPartner) send(partner, { t: 'partner_left' });
}

function pair(a, b, friends = false) {
  a.partner = b;
  b.partner = a;
  // caller initiates the WebRTC offer
  send(a, { t: 'matched', role: 'caller', friends });
  send(b, { t: 'matched', role: 'callee', friends });
}

// leave whatever we were doing before starting something new
function reset(ws) {
  unpair(ws);
  removeFromQueue(ws);
  closeRoom(ws);
}

// ---- protocol ------------------------------------------------------------
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.t) {
      case 'find': {
        reset(ws);
        while (queue.length) {
          const other = queue.shift();
          if (other !== ws && other.readyState === other.OPEN) {
            pair(ws, other);
            return;
          }
        }
        queue.push(ws);
        send(ws, { t: 'waiting' });
        break;
      }

      case 'cancel': {
        reset(ws);
        break;
      }

      case 'create_room': {
        reset(ws);
        let code;
        do {
          code = crypto.randomBytes(3).toString('hex').toUpperCase();
        } while (rooms.has(code));
        rooms.set(code, ws);
        ws.roomCode = code;
        send(ws, { t: 'room_created', code });
        break;
      }

      case 'join_room': {
        reset(ws);
        const code = String(msg.code || '').toUpperCase();
        const host = rooms.get(code);
        if (!host || host.readyState !== host.OPEN || host === ws) {
          rooms.delete(code);
          send(ws, { t: 'room_error' });
          return;
        }
        rooms.delete(code);
        host.roomCode = null;
        pair(host, ws, true);
        break;
      }

      case 'signal': {
        send(ws.partner, { t: 'signal', data: msg.data });
        break;
      }

      case 'chat': {
        const text = String(msg.text || '').slice(0, 500).trim();
        if (text) send(ws.partner, { t: 'chat', text });
        break;
      }

      case 'game_invite': {
        send(ws.partner, { t: 'game_invite', game: msg.game });
        break;
      }

      case 'game_decline': {
        send(ws.partner, { t: 'game_decline' });
        break;
      }

      case 'game_accept': {
        const partner = ws.partner;
        if (!partner) return;
        // shared seed (e.g. picks the Wordle word) + random first player
        const seed = crypto.randomInt(2 ** 31);
        const accepterFirst = Math.random() < 0.5;
        send(ws, { t: 'game_start', game: msg.game, seed, first: accepterFirst });
        send(partner, { t: 'game_start', game: msg.game, seed, first: !accepterFirst });
        break;
      }

      case 'game_move': {
        send(ws.partner, { t: 'game_move', data: msg.data });
        break;
      }

      case 'game_quit': {
        send(ws.partner, { t: 'game_quit' });
        break;
      }

      case 'skip': {
        unpair(ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    removeFromQueue(ws);
    closeRoom(ws);
    unpair(ws);
  });
});

// drop dead connections so nobody waits forever on a ghost
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`GameCam running on http://localhost:${PORT}`);
});
