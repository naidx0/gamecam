// WebRTC peer connection management. Signaling goes through the server socket.
import { send } from './socket.js';

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

let pc = null;
let localStream = null;
let pendingCandidates = [];

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

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) send({ t: 'signal', data: { candidate: e.candidate } });
  };

  pc.ontrack = (e) => {
    if (remoteVideo.srcObject !== e.streams[0]) remoteVideo.srcObject = e.streams[0];
  };

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ t: 'signal', data: { sdp: pc.localDescription } });
  }
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
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
    pc = null;
  }
  pendingCandidates = [];
}

export function setMicEnabled(on) {
  localStream?.getAudioTracks().forEach((t) => (t.enabled = on));
}

export function setCamEnabled(on) {
  localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
}
