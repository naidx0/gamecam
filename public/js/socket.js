// Thin WebSocket wrapper with auto-reconnect.
let ws = null;
let handlers = {};
let openQueue = [];
let reconnectDelay = 500;

export function onMessage(map) {
  handlers = map;
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('open', () => {
    reconnectDelay = 500;
    openQueue.forEach((msg) => ws.send(JSON.stringify(msg)));
    openQueue = [];
    handlers._open?.();
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    handlers[msg.t]?.(msg);
  });

  ws.addEventListener('close', () => {
    handlers._close?.();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  });
}

export function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    openQueue.push(msg);
  }
}
