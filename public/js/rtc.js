// WebRTC peer connection management. Signaling goes through the server socket.
import { send } from './socket.js';

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

let pc = null;
let localStream = null;
let pendingCandidates = [];
let isCallerPeer = false;
let restartedIce = false;
let onConnectionFailed = null;
let connectTimer = null;
let disconnectTimer = null;

// give the connection ~15s to reach 'connected'; a 'disconnected' state gets a
// 5s grace window before we treat it as a real failure
const CONNECT_TIMEOUT_MS = 15000;
const DISCONNECT_GRACE_MS = 5000;

export function setConnectionFailedHandler(cb) {
  onConnectionFailed = cb;
}

function clearRtcTimers() {
  clearTimeout(connectTimer);
  clearTimeout(disconnectTimer);
  connectTimer = null;
  disconnectTimer = null;
}

function fireConnectionFailed() {
  if (!pc) return;
  clearRtcTimers();
  onConnectionFailed?.();
}

export async function getLocalStream() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 960 }, height: { ideal: 720 } },
    audio: true,
  });
  return localStream;
}

export function getStream() {
  return localStream;
}

export async function startPeer(isCaller, remoteVideo) {
  closePeer();
  pc = new RTCPeerConnection(RTC_CONFIG);
  pendingCandidates = [];
  isCallerPeer = isCaller;
  restartedIce = false;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) send({ t: 'signal', data: { candidate: e.candidate } });
  };

  pc.ontrack = (e) => {
    if (remoteVideo.srcObject !== e.streams[0]) remoteVideo.srcObject = e.streams[0];
  };

  // caller re-offers whenever renegotiation is needed (e.g. after restartIce)
  pc.onnegotiationneeded = async () => {
    if (!isCallerPeer || !pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ t: 'signal', data: { sdp: pc.localDescription } });
    } catch (err) {
      console.warn('renegotiation error', err);
    }
  };

  pc.oniceconnectionstatechange = () => handleStateChange();
  pc.onconnectionstatechange = () => handleStateChange();

  // if we never reach 'connected' in time, treat it as a failure
  connectTimer = setTimeout(() => {
    if (pc && !isConnected()) fireConnectionFailed();
  }, CONNECT_TIMEOUT_MS);

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ t: 'signal', data: { sdp: pc.localDescription } });
  }
}

function isConnected() {
  if (!pc) return false;
  const s = pc.connectionState || pc.iceConnectionState;
  return s === 'connected' || s === 'completed';
}

function handleStateChange() {
  if (!pc) return;
  const state = pc.connectionState || pc.iceConnectionState;

  if (state === 'connected' || state === 'completed') {
    clearRtcTimers();
    return;
  }

  if (state === 'failed') {
    // one automatic ICE restart before giving up; the caller re-offers via
    // onnegotiationneeded
    if (!restartedIce) {
      restartedIce = true;
      try {
        pc.restartIce();
      } catch (err) {
        console.warn('restartIce error', err);
      }
      return;
    }
    fireConnectionFailed();
    return;
  }

  if (state === 'disconnected') {
    // brief blips recover on their own; only fail if it stays down
    clearTimeout(disconnectTimer);
    disconnectTimer = setTimeout(() => {
      if (pc && !isConnected()) fireConnectionFailed();
    }, DISCONNECT_GRACE_MS);
    return;
  }

  // any healthy transition cancels a pending disconnect timer
  clearTimeout(disconnectTimer);
  disconnectTimer = null;
}

export async function handleSignal(data) {
  if (!pc) return;
  try {
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ t: 'signal', data: { sdp: pc.localDescription } });
      }
      // flush candidates that arrived before the remote description
      for (const c of pendingCandidates) await pc.addIceCandidate(c);
      pendingCandidates = [];
    } else if (data.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(data.candidate);
      } else {
        pendingCandidates.push(data.candidate);
      }
    }
  } catch (err) {
    console.warn('signal error', err);
  }
}

export function closePeer() {
  clearRtcTimers();
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onnegotiationneeded = null;
    pc.oniceconnectionstatechange = null;
    pc.onconnectionstatechange = null;
    pc.close();
    pc = null;
  }
  pendingCandidates = [];
  restartedIce = false;
}

export function setMicEnabled(on) {
  localStream?.getAudioTracks().forEach((t) => (t.enabled = on));
}

export function setCamEnabled(on) {
  localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
}
