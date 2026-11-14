/**
 * BoothTogether - WebRTC Peer-to-Peer Manager & Live Video Call
 * Robust connection with Google STUN + Public TURN relays,
 * ICE candidate queueing, automatic track binding, two-way voice call,
 * speaking indicators, and mobile camera switching.
 */

class BoothWebRTC {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.currentFacingMode = 'user'; // 'user' or 'environment'
    this.isMuted = false;
    this.isVideoOff = false;
    this.isDemoMode = false;
    this.demoAnimFrame = null;
    this.partnerVolume = 1.0;

    // Buffer for ICE candidates that arrive before setRemoteDescription()
    this.pendingCandidates = [];

    // Audio analyzers for live speaking wave indicators
    this.audioContext = null;
    this.localAudioAnalyser = null;
    this.remoteAudioAnalyser = null;
    this.analyserAnimFrame = null;

    // STUN and public TURN servers for robust NAT & firewall traversal
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'stun:openrelay.metered.ca:80' },
        // Public TURN relay with verified secret for strict mobile NAT / 4G / 5G / Wi-Fi traversal
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayprojectsecret'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayprojectsecret'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayprojectsecret'
        }
      ],
      iceCandidatePoolSize: 10
    };

    this.onRemoteTrackReceived = null;
    this.onConnectionStateChange = null;
    this.onCameraReady = null;
  }

  /**
   * Request user media (Camera + Microphone) with high audio fidelity for calls
   */
  async startLocalMedia(facingMode = 'user') {
    this.currentFacingMode = facingMode;

    const constraints = {
      video: {
        facingMode: this.currentFacingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };

    console.log('Requesting Camera and Microphone with constraints:', constraints);

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✓ Successfully acquired Camera and Microphone stream');
    } catch (err) {
      console.warn('Full media constraints failed, trying with default audio/video...', err.name);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
      } catch (videoAudioErr) {
        console.warn('Video + Audio failed, falling back to video only...', videoAudioErr);
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: this.currentFacingMode }
          });
        } catch (videoOnlyErr) {
          console.error('Camera access completely denied:', videoOnlyErr);
          throw videoOnlyErr;
        }
      }
    }

    this.isDemoMode = false;
    this.attachLocalStreamToDom();

    // If RTCPeerConnection already exists, bind the local tracks now!
    if (this.peerConnection) {
      this.bindLocalTracksToPeerConnection();
    }

    // Initialize local voice activity analyzer
    this.setupLocalAudioAnalysis();

    if (this.onCameraReady) {
      this.onCameraReady(this.localStream);
    }

    return this.localStream;
  }

  /**
   * Attach local stream to local video element
   */
  attachLocalStreamToDom() {
    const localVideo = document.getElementById('local-video');
    if (localVideo && this.localStream) {
      localVideo.srcObject = this.localStream;
      localVideo.muted = true; // Local preview MUST be muted to prevent audio loop feedback
      localVideo.playsInline = true;
      localVideo.autoplay = true;

      localVideo.play().catch(e => console.warn('Local video play error:', e));
    }
  }

  /**
   * Ensure local media tracks are added to RTCPeerConnection
   */
  async ensureLocalTracksAdded() {
    if (!this.localStream) {
      console.log('Local stream not ready yet. Requesting local media before WebRTC negotiation...');
      await this.startLocalMedia(this.currentFacingMode);
    }
    this.bindLocalTracksToPeerConnection();
  }

  bindLocalTracksToPeerConnection() {
    if (!this.peerConnection || !this.localStream) return;

    const existingSenders = this.peerConnection.getSenders();
    this.localStream.getTracks().forEach(track => {
      const alreadyAdded = existingSenders.some(s => s.track && s.track.id === track.id);
      if (!alreadyAdded) {
        console.log(`Adding local track to RTCPeerConnection: [${track.kind}] ${track.label}`);
        this.peerConnection.addTrack(track, this.localStream);
      }
    });
  }

  /**
   * Create and configure RTCPeerConnection with buffered ICE candidate queueing
   */
  createPeerConnection(signalingClient) {
    if (this.peerConnection) {
      console.log('Closing existing RTCPeerConnection to re-negotiate cleanly...');
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.pendingCandidates = [];
    console.log('Creating new RTCPeerConnection...');
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Bind local media tracks if already available
    if (this.localStream) {
      this.bindLocalTracksToPeerConnection();
    }

    // ICE Candidate generation -> send to partner with reliable object serialization
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const candObj = event.candidate.toJSON ? event.candidate.toJSON() : {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment
        };
        signalingClient.sendSignal({
          candidate: candObj
        });
      }
    };

    // ICE Connection State tracking
    this.peerConnection.oniceconnectionstatechange = () => {
      const iceState = this.peerConnection.iceConnectionState;
      console.log(`WebRTC ICE Connection State: ${iceState}`);
      if (iceState === 'connected' || iceState === 'completed') {
        this.hideWaitingPlaceholder();
      } else if (iceState === 'failed') {
        console.warn('ICE connection failed. Restarting ICE negotiation...');
        if (this.peerConnection.restartIce) {
          this.peerConnection.restartIce();
        }
      }
    };

    // Connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log(`WebRTC Overall State: ${state}`);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(state);
      }
      if (state === 'connected') {
        this.hideWaitingPlaceholder();
      }
    };

    // Remote Track Handler: receives partner's video and audio tracks
    this.peerConnection.ontrack = (event) => {
      console.log(`>>> REMOTE TRACK RECEIVED: kind=${event.track.kind}, id=${event.track.id}, readyState=${event.track.readyState}`);

      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }

      // Add track to persistent remoteStream if not already present
      const alreadyPresent = this.remoteStream.getTracks().some(t => t.id === event.track.id);
      if (!alreadyPresent) {
        this.remoteStream.addTrack(event.track);
      }

      // Also listen to track unmuting (when media packets actually start flowing)
      event.track.onunmute = () => {
        console.log(`>>> Remote track unmuted (media packets flowing): [${event.track.kind}]`);
        this.handleRemoteStream(this.remoteStream);
      };

      this.handleRemoteStream(this.remoteStream);
    };

    return this.peerConnection;
  }

  /**
   * Handle incoming remote MediaStream (Used by both native WebRTC and PeerJS)
   */
  handleRemoteStream(stream) {
    if (!stream) return;
    this.remoteStream = stream;
    const tracks = stream.getTracks();
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    console.log(`>>> Binding remote stream to DOM (Total tracks: ${tracks.length}, Video: ${videoTracks.length}, Audio: ${audioTracks.length})`);

    this.hideWaitingPlaceholder();

    // 1. Bind to Remote Video element
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
      remoteVideo.classList.remove('hidden');
      // Crucial: remoteVideo MUST be muted so video autoplay is never blocked by browser policy!
      remoteVideo.muted = true;
      remoteVideo.playsInline = true;
      remoteVideo.autoplay = true;

      // Always rebind or refresh srcObject when a video track is present
      if (remoteVideo.srcObject !== stream || remoteVideo.paused) {
        remoteVideo.srcObject = stream;
      }

      const vPlay = remoteVideo.play();
      if (vPlay !== undefined) {
        vPlay.then(() => {
          console.log('✓ Remote video playback active and rendering frames');
        }).catch(err => {
          console.warn('Remote video playback warning (retrying):', err);
          remoteVideo.muted = true;
          remoteVideo.play().catch(() => {});
        });
      }
    }

    // 2. Bind to Dedicated Remote Audio element for two-way voice call
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
      if (remoteAudio.srcObject !== stream || remoteAudio.paused) {
        remoteAudio.srcObject = stream;
      }
      remoteAudio.volume = this.partnerVolume;
      const aPlay = remoteAudio.play();
      if (aPlay !== undefined) {
        aPlay.then(() => {
          console.log('✓ Remote audio voice call playback active');
        }).catch(err => {
          console.warn('Remote audio autoplay blocked by browser policy (banner displayed):', err);
          this.showAutoplayUnblockBanner();
        });
      }
    }

    // 3. Start audio volume visualizer (shows speaking wave indicator on partner)
    if (audioTracks.length > 0) {
      this.setupRemoteAudioAnalysis(stream);
    }

    if (this.onRemoteTrackReceived) {
      this.onRemoteTrackReceived(stream);
    }
  }

  hideWaitingPlaceholder() {
    const placeholder = document.getElementById('remote-waiting-placeholder');
    if (placeholder) {
      placeholder.classList.add('hidden');
    }
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
      remoteVideo.classList.remove('hidden');
    }
  }

  /**
   * Initiator creates WebRTC Offer and sends to Receiver
   */
  async createAndSendOffer(signalingClient) {
    if (!this.peerConnection) {
      this.createPeerConnection(signalingClient);
    }

    try {
      await this.ensureLocalTracksAdded();

      console.log('Creating WebRTC Offer with audio & video...');
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await this.peerConnection.setLocalDescription(offer);

      signalingClient.sendSignal({
        desc: this.peerConnection.localDescription
      });
    } catch (err) {
      console.error('Error creating WebRTC offer:', err);
    }
  }

  /**
   * Handle incoming WebRTC signaling data with buffered ICE queueing
   */
  async handleSignalingData(signalingClient, data) {
    if (!this.peerConnection) {
      this.createPeerConnection(signalingClient);
    }

    try {
      if (data.desc) {
        const desc = new RTCSessionDescription(data.desc);

        if (desc.type === 'offer') {
          console.log('Received WebRTC Offer from partner. Ensuring local tracks ready...');
          await this.ensureLocalTracksAdded();

          console.log('Setting remote description (Offer)...');
          await this.peerConnection.setRemoteDescription(desc);

          // Flush any ICE candidates that arrived before the offer was set!
          await this.flushPendingCandidates();

          console.log('Creating WebRTC Answer...');
          const answer = await this.peerConnection.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
          await this.peerConnection.setLocalDescription(answer);

          signalingClient.sendSignal({
            desc: this.peerConnection.localDescription
          });
        } else if (desc.type === 'answer') {
          console.log('Received WebRTC Answer from partner. Setting remote description...');
          await this.peerConnection.setRemoteDescription(desc);

          // Flush any ICE candidates that arrived before the answer was set!
          await this.flushPendingCandidates();
        }
      } else if (data.candidate) {
        // Crucial WebRTC Candidate Handling:
        // Pass candidate init dictionary directly to addIceCandidate()
        const candData = data.candidate;
        if (candData && candData.candidate && typeof candData.candidate === 'string' && candData.candidate.trim().length > 0) {
          if (this.peerConnection && this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
            try {
              await this.peerConnection.addIceCandidate(candData);
            } catch (e) {
              console.warn('Error adding ICE candidate:', e);
            }
          } else {
            console.log('Buffering early ICE candidate until remote description is set...');
            this.pendingCandidates.push(candData);
          }
        }
      }
    } catch (err) {
      console.error('Error handling WebRTC signaling data:', err);
    }
  }

  /**
   * Flush queued ICE candidates
   */
  async flushPendingCandidates() {
    if (!this.pendingCandidates || this.pendingCandidates.length === 0) return;

    console.log(`Flushing ${this.pendingCandidates.length} queued ICE candidates...`);
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch (err) {
        console.warn('Error applying queued ICE candidate:', err);
      }
    }
  }

  /**
   * Toggle Local Microphone Mute
   */
  toggleMute() {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.isMuted = !this.isMuted;
      audioTrack.enabled = !this.isMuted;
    } else {
      this.isMuted = true;
    }

    const speakingLabel = document.getElementById('local-speaking-label');
    if (speakingLabel) {
      speakingLabel.textContent = this.isMuted ? 'You (Muted)' : 'You';
    }

    return this.isMuted;
  }

  /**
   * Adjust Partner Voice Call Volume
   */
  setPartnerVolume(volumePct) {
    this.partnerVolume = Math.min(1, Math.max(0, volumePct / 100));
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
      remoteAudio.volume = this.partnerVolume;
    }
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
      remoteVideo.volume = this.partnerVolume;
    }
  }

  /**
   * Show banner if browser autoplay policy blocked sound
   */
  showAutoplayUnblockBanner() {
    const banner = document.getElementById('btn-unmute-call');
    if (banner) {
      banner.classList.remove('hidden');
      banner.onclick = () => {
        const remoteAudio = document.getElementById('remote-audio');
        if (remoteAudio) remoteAudio.play();
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) remoteVideo.play();
        banner.classList.add('hidden');
      };
    }
  }

  /**
   * Live Voice Call Activity Visualizer (Measures audio energy for speaking waves)
   */
  setupRemoteAudioAnalysis(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioContext) this.audioContext = new AudioCtx();

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) return;

      const source = this.audioContext.createMediaStreamSource(stream);
      this.remoteAudioAnalyser = this.audioContext.createAnalyser();
      this.remoteAudioAnalyser.fftSize = 64;
      source.connect(this.remoteAudioAnalyser);

      const bufferLength = this.remoteAudioAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkSpeaking = () => {
        if (!this.remoteAudioAnalyser) return;
        this.remoteAudioAnalyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // Visual speaking indicator on partner's badge
        const partnerBadge = document.getElementById('partner-user-badge');
        const partnerLabel = document.getElementById('partner-speaking-label');

        if (average > 15) {
          if (partnerBadge) partnerBadge.classList.add('speaking-active');
          if (partnerLabel) partnerLabel.textContent = 'Speaking... 🎙️';
        } else {
          if (partnerBadge) partnerBadge.classList.remove('speaking-active');
          if (partnerLabel) partnerLabel.textContent = 'Partner 💕';
        }

        this.analyserAnimFrame = requestAnimationFrame(checkSpeaking);
      };
      checkSpeaking();
    } catch (e) {
      console.warn('Audio analysis setup error:', e);
    }
  }

  setupLocalAudioAnalysis() {
    try {
      if (!this.localStream) return;
      const audioTracks = this.localStream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) return;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioContext) this.audioContext = new AudioCtx();

      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.localAudioAnalyser = this.audioContext.createAnalyser();
      this.localAudioAnalyser.fftSize = 64;
      source.connect(this.localAudioAnalyser);

      const bufferLength = this.localAudioAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkLocalSpeaking = () => {
        if (!this.localAudioAnalyser) return;
        this.localAudioAnalyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        const localBadge = document.getElementById('local-user-badge');
        if (average > 15 && !this.isMuted) {
          if (localBadge) localBadge.classList.add('speaking-active');
        } else {
          if (localBadge) localBadge.classList.remove('speaking-active');
        }

        requestAnimationFrame(checkLocalSpeaking);
      };
      checkLocalSpeaking();
    } catch (e) {
      console.warn('Local audio analysis setup error:', e);
    }
  }

  /**
   * Flip Camera between front ("user") and back ("environment")
   */
  async flipCamera() {
    const newFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
    console.log(`Flipping camera to: ${newFacingMode}`);

    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => track.stop());
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });

      this.currentFacingMode = newFacingMode;
      const newVideoTrack = newStream.getVideoTracks()[0];

      if (this.localStream) {
        const oldVideoTrack = this.localStream.getVideoTracks()[0];
        if (oldVideoTrack) {
          this.localStream.removeTrack(oldVideoTrack);
        }
        this.localStream.addTrack(newVideoTrack);
      } else {
        this.localStream = newStream;
      }

      if (this.peerConnection) {
        const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(newVideoTrack);
        }
      }

      this.attachLocalStreamToDom();

      const localVideo = document.getElementById('local-video');
      if (localVideo) {
        localVideo.classList.toggle('mirrored', newFacingMode === 'user');
      }

      return true;
    } catch (err) {
      console.error('Failed to flip camera:', err);
      await this.startLocalMedia(this.currentFacingMode);
      return false;
    }
  }

  /**
   * Fallback Solo/Demo Mode
   */
  startDemoStream() {
    this.isDemoMode = true;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    let frame = 0;
    const render = () => {
      frame++;
      ctx.fillStyle = '#1A1820';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const grad = ctx.createRadialGradient(320, 240, 40, 320, 240, 280);
      grad.addColorStop(0, 'rgba(224, 90, 71, 0.45)');
      grad.addColorStop(1, 'rgba(18, 18, 20, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(320, 220 + Math.sin(frame * 0.05) * 8);
      ctx.fillStyle = '#E05A47';
      ctx.font = '72px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💖', 0, 0);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 22px Outfit, sans-serif';
      ctx.fillText('Virtual Test Camera', 0, 70);
      ctx.font = '14px Outfit, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillText('Ready to pose & capture!', 0, 96);
      ctx.restore();

      this.demoAnimFrame = requestAnimationFrame(render);
    };
    render();

    this.localStream = canvas.captureStream(30);
    this.attachLocalStreamToDom();

    if (this.peerConnection) {
      this.bindLocalTracksToPeerConnection();
    }

    if (this.onCameraReady) {
      this.onCameraReady(this.localStream);
    }

    return this.localStream;
  }

  cleanup() {
    if (this.demoAnimFrame) cancelAnimationFrame(this.demoAnimFrame);
    if (this.analyserAnimFrame) cancelAnimationFrame(this.analyserAnimFrame);
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.remoteStream = null;
  }
}

// Global WebRTC manager
window.boothWebRTC = new BoothWebRTC();
