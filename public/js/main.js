import * as socket from './socket.js';
import * as rtc from './rtc.js';
import { GAMES } from './games/registry.js';

// ---- dom -------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const screenHome = $('screen-home');
const screenChat = $('screen-chat');
const btnStart = $('btn-start');
const btnFriend = $('btn-friend');
const friendBox = $('friend-box');
const friendLink = $('friend-link');
const btnCopy = $('btn-copy');

const statusDot = $('status-dot');
const statusText = $('status-text');
const scoreboard = $('scoreboard');
const scoreMe = $('score-me');
const scoreThem = $('score-them');
const scoreThemName = $('score-them-name');

const localVideo = $('local-video');
const remoteVideo = $('remote-video');
const remoteOverlay = $('remote-overlay');
const remoteOverlayText = $('remote-overlay-text');
const btnMic = $('btn-mic');
const btnCam = $('btn-cam');
const btnGamebox = $('btn-gamebox');
const btnSkip = $('btn-skip');

const stagePanels = {
  idle: $('stage-idle'),
  gamebox: $('stage-gamebox'),
  waiting: $('stage-waiting'),
  game: $('stage-game'),
  result: $('stage-result'),
};
const stageIdleTitle = $('stage-idle-title');
const stageIdleSub = $('stage-idle-sub');
const btnOpenGamebox = $('btn-open-gamebox');
const idleLinkRow = $('idle-link-row');
const idleLink = $('idle-link');
const btnIdleCopy = $('btn-idle-copy');
const gameboxGrid = $('gamebox-grid');
const btnCloseGamebox = $('btn-close-gamebox');
const btnCancelInvite = $('btn-cancel-invite');
const gameTitle = $('game-title');
const gameTurn = $('game-turn');
const gameTimer = $('game-timer');
const btnQuitGame = $('btn-quit-game');
const gameArea = $('game-area');
const resultText = $('result-text');
const btnRematch = $('btn-rematch');
const btnAnotherGame = $('btn-another-game');
const btnResultSkip = $('btn-result-skip');

const chatMessages = $('chat-messages');
const chatForm = $('chat-form');
const chatInput = $('chat-input');
const chatSend = $('chat-send');

const modalInvite = $('modal-invite');
const inviteText = $('invite-text');
const btnAcceptInvite = $('btn-accept-invite');
const btnDeclineInvite = $('btn-decline-invite');
const toast = $('toast');

// ---- state -----------------------------------------------------------------
let paired = false;
let friendMode = false;
let micOn = true;
let camOn = true;
let score = { me: 0, them: 0 };
let activeGame = null; // { id, instance }
let lastGameId = null; // for rematch
let incomingInvite = null; // game id waiting on my accept
let toastTimer = null;

const roomFromUrl = new URLSearchParams(location.search).get('room');
const partnerName = () => (friendMode ? 'Friend' : 'Stranger');

// ---- helpers ---------------------------------------------------------------
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2600);
}

function setStatus(text, live) {
  statusText.textContent = text;
  statusDot.classList.toggle('live', Boolean(live));
}

function showStage(name) {
  for (const [key, el] of Object.entries(stagePanels)) el.hidden = key !== name;
}

function addMsg(text, cls) {
  const el = document.createElement('div');
  el.className = `msg ${cls}`;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setChatEnabled(on) {
  chatInput.disabled = !on;
  chatSend.disabled = !on;
}

function updateScore() {
  scoreMe.textContent = score.me;
  scoreThem.textContent = score.them;
  scoreThemName.textContent = partnerName();
}

// fast turn timer: move within the window or a random legal move is played
const TURN_SECONDS = 10;
let turnInterval = null;
let turnDeadline = 0;

function clearTurnTimer() {
  clearInterval(turnInterval);
  turnInterval = null;
  gameTimer.hidden = true;
}

function startTurnTimer() {
  clearTurnTimer();
  turnDeadline = Date.now() + TURN_SECONDS * 1000;
  gameTimer.hidden = false;
  const tick = () => {
    const left = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
    gameTimer.textContent = `${left}s`;
    gameTimer.classList.toggle('low', left <= 3);
    if (left <= 0) {
      clearTurnTimer();
      activeGame?.instance.randomMove?.();
    }
  };
  tick();
  turnInterval = setInterval(tick, 250);
}

function destroyGame() {
  if (activeGame) {
    activeGame.instance.destroy();
    activeGame = null;
  }
  clearTurnTimer();
  gameArea.textContent = '';
  gameTurn.hidden = true;
}

// tear down the current pairing (video + chat + game)
function teardownPairing() {
  paired = false;
  destroyGame();
  incomingInvite = null;
  modalInvite.hidden = true;
  rtc.closePeer();
  remoteVideo.srcObject = null;
  remoteOverlay.hidden = false;
  setChatEnabled(false);
  scoreboard.hidden = true;
  showStage('idle');
}

function resetIdlePanel() {
  btnOpenGamebox.hidden = false;
  idleLinkRow.hidden = true;
}

function startSearching() {
  teardownPairing();
  resetIdlePanel();
  stageIdleTitle.textContent = 'Finding someone…';
  stageIdleSub.textContent = 'Hang tight — matches are usually instant.';
  chatMessages.textContent = '';
  remoteOverlayText.textContent = 'Looking for someone…';
  setStatus('Looking for someone…', false);
  socket.send({ t: 'find' });
}

function enterChatScreen() {
  screenHome.hidden = true;
  screenChat.hidden = false;
}

async function requestMedia() {
  try {
    const stream = await rtc.getLocalStream();
    localVideo.srcObject = stream;
    return true;
  } catch (err) {
    console.warn(err);
    showToast('Camera and mic access is required to play');
    return false;
  }
}

// ---- home actions ----------------------------------------------------------
if (roomFromUrl) {
  btnStart.textContent = 'Join your friend';
  btnFriend.hidden = true;
}

btnStart.addEventListener('click', async () => {
  if (!(await requestMedia())) return;
  enterChatScreen();
  if (roomFromUrl) {
    friendMode = true;
    teardownPairing();
    remoteOverlayText.textContent = 'Joining your friend…';
    setStatus('Joining your friend…', false);
    socket.send({ t: 'join_room', code: roomFromUrl });
  } else {
    friendMode = false;
    startSearching();
  }
});

btnFriend.addEventListener('click', async () => {
  if (!(await requestMedia())) return;
  socket.send({ t: 'create_room' });
});

async function copyLink(input, btn) {
  try {
    await navigator.clipboard.writeText(input.value);
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  } catch {
    input.select();
    document.execCommand?.('copy');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  }
}

// copying the link is the "I'm ready" gesture: drop the host straight into
// the room, where only the link can bring their friend in
btnCopy.addEventListener('click', async () => {
  await copyLink(friendLink, btnCopy);
  setTimeout(enterWaitingRoom, 400);
});

btnIdleCopy.addEventListener('click', () => copyLink(idleLink, btnIdleCopy));

function enterWaitingRoom() {
  friendMode = true;
  enterChatScreen();
  teardownPairing();
  stageIdleTitle.textContent = 'Waiting for your friend…';
  stageIdleSub.textContent = 'They can only join through your link — resend it if they lost it.';
  btnOpenGamebox.hidden = true;
  idleLink.value = friendLink.value;
  idleLinkRow.hidden = false;
  remoteOverlayText.textContent = 'Waiting for your friend to join…';
  setStatus('Waiting for your friend…', false);
}

// ---- controls ----------------------------------------------------------------
btnMic.addEventListener('click', () => {
  micOn = !micOn;
  rtc.setMicEnabled(micOn);
  btnMic.classList.toggle('off', !micOn);
});

btnCam.addEventListener('click', () => {
  camOn = !camOn;
  rtc.setCamEnabled(camOn);
  btnCam.classList.toggle('off', !camOn);
});

function skipToNext() {
  if (paired) socket.send({ t: 'skip' });
  friendMode = false;
  startSearching();
}

btnSkip.addEventListener('click', skipToNext);
btnResultSkip.addEventListener('click', skipToNext);

// ---- gamebox ----------------------------------------------------------------
for (const game of Object.values(GAMES)) {
  const card = document.createElement('button');
  card.className = 'game-card';
  card.innerHTML = `
    <div class="gc-name"></div>
    <div class="gc-desc"></div>`;
  card.querySelector('.gc-name').textContent = game.name;
  card.querySelector('.gc-desc').textContent = game.desc;
  card.addEventListener('click', () => sendInvite(game.id));
  gameboxGrid.appendChild(card);
}

function openGamebox() {
  if (!paired) {
    showToast('Wait until you are connected with someone');
    return;
  }
  destroyGame();
  showStage('gamebox');
}

btnGamebox.addEventListener('click', openGamebox);
btnOpenGamebox.addEventListener('click', openGamebox);
btnCloseGamebox.addEventListener('click', () => showStage('idle'));
btnAnotherGame.addEventListener('click', openGamebox);

function sendInvite(gameId) {
  if (!paired) return;
  lastGameId = gameId;
  socket.send({ t: 'game_invite', game: gameId });
  $('waiting-text').textContent = `Waiting for them to accept ${GAMES[gameId].name}…`;
  showStage('waiting');
}

btnCancelInvite.addEventListener('click', () => showStage('gamebox'));

btnRematch.addEventListener('click', () => {
  if (lastGameId) sendInvite(lastGameId);
});

btnQuitGame.addEventListener('click', () => {
  socket.send({ t: 'game_quit' });
  destroyGame();
  showStage('idle');
  addMsg('You quit the game', 'sys');
});

// ---- invite modal -------------------------------------------------------------
btnAcceptInvite.addEventListener('click', () => {
  if (!incomingInvite) return;
  socket.send({ t: 'game_accept', game: incomingInvite });
  modalInvite.hidden = true;
  incomingInvite = null;
});

btnDeclineInvite.addEventListener('click', () => {
  socket.send({ t: 'game_decline' });
  modalInvite.hidden = true;
  incomingInvite = null;
});

// ---- game lifecycle -------------------------------------------------------------
function launchGame(gameId, seed, first) {
  const game = GAMES[gameId];
  if (!game) return;
  destroyGame();
  modalInvite.hidden = true;
  incomingInvite = null;
  lastGameId = gameId;
  gameTitle.textContent = game.name;
  showStage('game');

  const ctx = {
    seed,
    first,
    sendMove: (data) => socket.send({ t: 'game_move', data }),
    setTurn: (mine) => {
      if (mine === null) {
        gameTurn.hidden = true;
        clearTurnTimer();
        return;
      }
      gameTurn.hidden = false;
      gameTurn.textContent = mine ? 'Your turn' : 'Their turn';
      gameTurn.classList.toggle('mine', mine);
      if (mine) startTurnTimer();
      else clearTurnTimer();
    },
    finish: (result) => finishGame(result),
  };
  activeGame = { id: gameId, instance: game.create(gameArea, ctx) };
  addMsg(`${game.name} started — good luck`, 'sys');
}

function finishGame(result) {
  gameTurn.hidden = true;
  clearTurnTimer();
  if (result === 'win') score.me++;
  if (result === 'lose') score.them++;
  updateScore();

  // let players see the final board for a beat before showing the result
  setTimeout(() => {
    destroyGame();
    if (!paired) return;
    if (result === 'win') resultText.textContent = 'You won';
    else if (result === 'lose') resultText.textContent = 'You lost';
    else resultText.textContent = 'Draw';
    showStage('result');
  }, 1400);
}

// ---- chat ---------------------------------------------------------------------
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !paired) return;
  socket.send({ t: 'chat', text });
  addMsg(text, 'me');
  chatInput.value = '';
});

// ---- socket events --------------------------------------------------------------
socket.onMessage({
  waiting() {
    setStatus('Looking for someone…', false);
  },

  async matched({ role, friends }) {
    enterChatScreen(); // a friend-room host gets matched while still on the home screen
    paired = true;
    friendMode = Boolean(friends);
    score = { me: 0, them: 0 };
    updateScore();
    scoreboard.hidden = false;
    chatMessages.textContent = '';
    setChatEnabled(true);
    showStage('idle');
    resetIdlePanel();
    stageIdleTitle.textContent = friendMode ? 'Your friend is here' : 'Say hi';
    stageIdleSub.textContent = 'Choose a game and challenge them to a quick round.';
    document.querySelector('.remote-tile .video-label').textContent = partnerName();
    remoteOverlayText.textContent = 'Connecting video…';
    setStatus(friendMode ? 'Connected with your friend' : 'Connected with a stranger', true);
    addMsg(friendMode ? 'Your friend joined — have fun' : 'You are connected — say hi', 'sys');
    await rtc.startPeer(role === 'caller', remoteVideo);
  },

  signal({ data }) {
    rtc.handleSignal(data);
  },

  room_created({ code }) {
    friendBox.hidden = false;
    btnFriend.hidden = true;
    friendLink.value = `${location.origin}/?room=${code}`;
  },

  room_error() {
    showToast('That invite link expired — ask for a new one');
    setStatus('Link expired', false);
    remoteOverlayText.textContent = 'Invite link expired — hit Skip to meet strangers instead';
  },

  chat({ text }) {
    addMsg(text, 'them');
  },

  game_invite({ game }) {
    const g = GAMES[game];
    if (!g || !paired) return;
    if (activeGame) {
      socket.send({ t: 'game_decline' });
      return;
    }
    incomingInvite = game;
    inviteText.textContent = `${partnerName()} wants to play ${g.name}`;
    modalInvite.hidden = false;
  },

  game_decline() {
    if (!stagePanels.waiting.hidden) {
      showToast('They passed on that game');
      showStage('gamebox');
    }
  },

  game_start({ game, seed, first }) {
    launchGame(game, seed, first);
  },

  game_move({ data }) {
    activeGame?.instance.onMove(data ?? {});
  },

  game_quit() {
    if (activeGame) {
      destroyGame();
      showStage('idle');
      addMsg(`${partnerName()} quit the game`, 'sys');
      showToast('They quit the game');
    }
  },

  partner_left() {
    addMsg(`${partnerName()} left`, 'sys');
    const wasFriend = friendMode;
    teardownPairing();
    if (wasFriend) {
      setStatus('They left', false);
      remoteOverlayText.textContent = 'They left — hit Skip to meet strangers';
    } else {
      // straight back into the pool — speed is the format
      remoteOverlayText.textContent = 'They skipped — finding someone new…';
      setStatus('Finding someone new…', false);
      socket.send({ t: 'find' });
    }
  },

  _close() {
    setStatus('Reconnecting…', false);
  },

  _open() {
    // if we lost the socket mid-pairing, our partner is gone; requeue
    if (!screenChat.hidden && !paired) return;
    if (!screenChat.hidden && paired) {
      teardownPairing();
      startSearching();
    }
  },
});

// remote video actually flowing -> drop the overlay
remoteVideo.addEventListener('loadeddata', () => {
  remoteOverlay.hidden = true;
});

socket.connect();
