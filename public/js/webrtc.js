/**
 * BoothTogether - WebRTC Peer-to-Peer Manager
 * Robust connection with Google STUN servers, automatic NAT traversal,
 * mobile camera switcher, audio muting, and test mode fallback.
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

    // WebRTC Configuration with public Google STUN servers for NAT Traversal
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };

    this.onRemoteTrackReceived = null;
    this.onConnectionStateChange = null;
    this.onCameraReady = null;
  }

  /**
   * Request user media (Camera + Mic) with graceful fallback
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

    try {
      // 1. Try requesting both video and audio
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn('Full media constraints failed, trying video only...', err.name);
      try {
        // 2. Try requesting video only if mic is blocked or unavailable
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.currentFacingMode }
        });
      } catch (videoErr) {
        console.error('Camera access failed:', videoErr);
        throw videoErr;
      }
    }

    this.isDemoMode = false;
    this.attachLocalStreamToDom();

    if (this.onCameraReady) {
      this.onCameraReady(this.localStream);
    }

    return this.localStream;
  }

  /**
   * Attach local stream to the DOM element
   */
  attachLocalStreamToDom() {
    const localVideo = document.getElementById('local-video');
    if (localVideo && this.localStream) {
      localVideo.srcObject = this.localStream;
      localVideo.muted = true; // MUST be muted locally to prevent audio feedback loop
      localVideo.playsInline = true;
      localVideo.autoplay = true;

      localVideo.play().catch(e => console.warn('Local video play error:', e));
    }
  }

  /**
   * Flip Camera between front ("user") and back ("environment")
   */
  async flipCamera() {
    const newFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
    console.log(`Flipping camera to: ${newFacingMode}`);

    // Stop current video tracks
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

      // Update local stream tracks
      if (this.localStream) {
        const oldVideoTrack = this.localStream.getVideoTracks()[0];
        if (oldVideoTrack) {
          this.localStream.removeTrack(oldVideoTrack);
        }
        this.localStream.addTrack(newVideoTrack);
      } else {
        this.localStream = newStream;
      }

      // If active WebRTC peer connection, replace the sender track
      if (this.peerConnection) {
        const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(newVideoTrack);
        }
      }

      this.attachLocalStreamToDom();

      // Mirroring: front camera is mirrored, back camera is unmirrored
      const localVideo = document.getElementById('local-video');
      if (localVideo) {
        localVideo.classList.toggle('mirrored', newFacingMode === 'user');
      }

      return true;
    } catch (err) {
      console.error('Failed to flip camera:', err);
      // Fall back to original
      await this.startLocalMedia(this.currentFacingMode);
      return false;
    }
  }

  /**
   * Toggle Audio Mute
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
    return this.isMuted;
  }

  /**
   * Create and configure RTCPeerConnection
   */
  createPeerConnection(signalingClient) {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    console.log('Creating RTCPeerConnection with STUN servers...');
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Add local tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // ICE Candidate handler -> send over signaling channel to partner
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        signalingClient.sendSignal({
          candidate: event.candidate
        });
      }
    };

    // Connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log(`WebRTC Connection State: ${state}`);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(state);
      }
    };

    // Remote track arrived!
    this.peerConnection.ontrack = (event) => {
      console.log('Remote stream track received:', event.track.kind);
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) {
          remoteVideo.srcObject = this.remoteStream;
          remoteVideo.playsInline = true;
          remoteVideo.autoplay = true;
          remoteVideo.play().catch(e => console.warn('Remote video play error:', e));
        }
      }
      this.remoteStream.addTrack(event.track);

      if (this.onRemoteTrackReceived) {
        this.onRemoteTrackReceived(this.remoteStream);
      }
    };

    return this.peerConnection;
  }

  /**
   * Initiator creates WebRTC Offer and sends to Receiver
   */
  async createAndSendOffer(signalingClient) {
    if (!this.peerConnection) {
      this.createPeerConnection(signalingClient);
    }

    try {
      console.log('Creating WebRTC Offer...');
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
   * Handle incoming WebRTC signaling data (Offer, Answer, ICE candidate)
   */
  async handleSignalingData(signalingClient, data) {
    if (!this.peerConnection) {
      this.createPeerConnection(signalingClient);
    }

    try {
      if (data.desc) {
        const desc = new RTCSessionDescription(data.desc);

        if (desc.type === 'offer') {
          console.log('Received WebRTC Offer, setting remote description...');
          await this.peerConnection.setRemoteDescription(desc);
          
          console.log('Creating WebRTC Answer...');
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);

          signalingClient.sendSignal({
            desc: this.peerConnection.localDescription
          });
        } else if (desc.type === 'answer') {
          console.log('Received WebRTC Answer, setting remote description...');
          await this.peerConnection.setRemoteDescription(desc);
        }
      } else if (data.candidate) {
        try {
          const candidate = new RTCIceCandidate(data.candidate);
          await this.peerConnection.addIceCandidate(candidate);
        } catch (e) {
          console.warn('Failed to add ICE candidate:', e);
        }
      }
    } catch (err) {
      console.error('Error handling WebRTC signaling data:', err);
    }
  }

  /**
   * Fallback Solo/Demo Mode: Generates an animated test video stream
   * if physical webcam is unavailable, denied, or for testing.
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
      // Warm photobooth test pattern with smiling avatar
      ctx.fillStyle = '#1A1820';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Gradient glow
      const grad = ctx.createRadialGradient(320, 240, 40, 320, 240, 280);
      grad.addColorStop(0, 'rgba(224, 90, 71, 0.45)');
      grad.addColorStop(1, 'rgba(18, 18, 20, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Smiling heart mascot
      ctx.save();
      ctx.translate(320, 220 + Math.sin(frame * 0.05) * 8);
      ctx.fillStyle = '#E05A47';
      ctx.font = '72px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💖', 0, 0);

      // Text
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

    // Capture stream from canvas
    this.localStream = canvas.captureStream(30);
    this.attachLocalStreamToDom();

    if (this.onCameraReady) {
      this.onCameraReady(this.localStream);
    }

    return this.localStream;
  }

  cleanup() {
    if (this.demoAnimFrame) {
      cancelAnimationFrame(this.demoAnimFrame);
    }
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
