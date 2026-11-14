/**
 * BoothTogether - Hybrid Signaling Client
 * Supports BOTH:
 * 1. Native WebSocket Signaling Server (for Node.js server.js / Render / Railway)
 * 2. PeerJS Cloud WebRTC (automatic fallback for GitHub Pages & static hosting)
 */

class BoothSignaling {
  constructor() {
    this.ws = null;
    this.peer = null;
    this.peerConn = null;
    this.activeCall = null;
    this.connected = false;
    this.roomId = null;
    this.clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.role = null; // 'initiator' or 'receiver'
    this.callbacks = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 4;
    this.reconnectTimer = null;
    this.pendingJoin = null;

    // Detect if hosted statically on GitHub Pages
    this.isStaticHost = window.location.hostname.endsWith('github.io') ||
                        window.location.protocol === 'file:';
    this.mode = this.isStaticHost ? 'peerjs' : 'websocket';
  }

  on(event, callback) {
    if (!this.callbacks[event]) {
      this.callbacks[event] = [];
    }
    this.callbacks[event].push(callback);
  }

  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in event callback '${event}':`, e);
        }
      });
    }
  }

  connect() {
    if (this.mode === 'peerjs') {
      this.connected = true;
      this.emit('connected');
      if (this.pendingJoin) {
        this.joinRoom(this.pendingJoin.roomId, this.pendingJoin.name, this.pendingJoin.isCreator);
        this.pendingJoin = null;
      }
      return Promise.resolve();
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      console.log(`Connecting to WebSocket signaling server at ${wsUrl}...`);
      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        console.warn('WebSocket init failed, falling back to PeerJS cloud...', err);
        this.switchToPeerJsMode();
        resolve();
        return;
      }

      this.ws.onopen = () => {
        console.log('Connected to WebSocket signaling server');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');

        // Start heartbeat to keep Render reverse proxy connection alive
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.send('PING', { t: Date.now() });
          }
        }, 20000);

        if (this.pendingJoin) {
          this.joinRoom(this.pendingJoin.roomId, this.pendingJoin.name, this.pendingJoin.isCreator);
          this.pendingJoin = null;
        }

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', event.data, e);
        }
      };

      this.ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.emit('disconnected');

        // Only switch to PeerJS if explicitly on static hosting (like GitHub Pages)
        if (!wasConnected && this.isStaticHost) {
          console.log('WebSocket unavailable on static host. Using PeerJS serverless cloud...');
          this.switchToPeerJsMode();
          resolve();
          return;
        }

        // On Render / Node.js, attempt automatic reconnection
        if (this.reconnectAttempts < this.maxReconnectAttempts && this.roomId) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 6000);
          console.log(`WebSocket disconnected. Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            this.connect().then(() => {
              if (this.roomId) {
                this.joinRoom(this.roomId, 'Partner', this.role === 'initiator');
              }
            });
          }, delay);
        }
      };

      this.ws.onerror = () => {
        if (!this.connected && this.isStaticHost) {
          console.log('WebSocket failed on static host. Activating PeerJS serverless cloud mode...');
          this.switchToPeerJsMode();
          resolve();
        }
      };
    });
  }

  switchToPeerJsMode() {
    this.mode = 'peerjs';
    this.connected = true;
    this.emit('connected');
    if (this.roomId) {
      this.joinPeerJsRoom(this.roomId, this.role === 'initiator');
    }
  }

  joinRoom(roomId, name = 'Partner', isCreator = false) {
    this.roomId = (roomId || '').trim().toUpperCase();

    if (this.mode === 'peerjs') {
      this.joinPeerJsRoom(this.roomId, isCreator);
      return;
    }

    if (!this.connected) {
      this.pendingJoin = { roomId: this.roomId, name, isCreator };
      this.connect();
      return;
    }

    this.send('JOIN_ROOM', { name });
  }

  /**
   * PeerJS Serverless Mode for GitHub Pages
   */
  /**
   * Helper: Wait until local webcam/mic stream is ready before calling or answering
   */
  async getReadyLocalStream(maxWaitMs = 3500) {
    if (window.boothWebRTC?.localStream) {
      return window.boothWebRTC.localStream;
    }
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (window.boothWebRTC?.localStream) {
        return window.boothWebRTC.localStream;
      }
      await new Promise(r => setTimeout(r, 120));
    }
    // If user media still pending, attempt ensure or demo mode fallback
    if (window.boothWebRTC) {
      try {
        await window.boothWebRTC.ensureLocalTracksAdded();
        return window.boothWebRTC.localStream;
      } catch (e) {
        return window.boothWebRTC.startDemoStream();
      }
    }
    return null;
  }

  /**
   * PeerJS Serverless Mode for GitHub Pages (Equipped with full STUN + TURN relay)
   */
  joinPeerJsRoom(roomId, isCreator) {
    if (!window.Peer) {
      console.error('PeerJS library not loaded.');
      return;
    }

    const cleanRoom = roomId.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hostPeerId = `bt_${cleanRoom}_host`;
    const guestPeerId = `bt_${cleanRoom}_guest`;

    // Determine target peer ID
    const myPeerId = isCreator ? hostPeerId : guestPeerId;
    const targetPeerId = isCreator ? guestPeerId : hostPeerId;
    this.role = isCreator ? 'initiator' : 'receiver';

    console.log(`[PeerJS Cloud] Initializing peer ${myPeerId} (Role: ${this.role})...`);

    if (this.peer) {
      this.peer.destroy();
    }

    // Comprehensive STUN and TURN configuration for NAT/firewall traversal
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'stun:stun.services.mozilla.com' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ];

    this.peer = new Peer(myPeerId, {
      debug: 1,
      config: {
        iceServers: iceServers,
        sdpSemantics: 'unified-plan'
      }
    });

    this.peer.on('open', (id) => {
      console.log(`[PeerJS Cloud] Peer connected to cloud with ID: ${id}`);
      this.emit('room_joined', {
        roomId: this.roomId,
        clientId: id,
        role: this.role,
        userCount: isCreator ? 1 : 2
      });

      // If guest/joiner, connect data channel to host
      if (!isCreator) {
        setTimeout(() => {
          this.connectToPeer(targetPeerId);
        }, 500);
      }
    });

    // Handle incoming data channel connection (Host receives connection from Guest)
    this.peer.on('connection', (conn) => {
      console.log('[PeerJS Cloud] Partner connected to data channel:', conn.peer);
      this.setupPeerDataConnection(conn);

      this.emit('peer_joined', {
        roomId: this.roomId,
        peerId: conn.peer,
        peerName: 'Partner',
        shouldInitiateOffer: false
      });

      // Media call watchdog: if host doesn't receive a call within 3 seconds, initiate call to guest
      setTimeout(async () => {
        if (!this.activeCall && this.peerConn && this.peerConn.open) {
          console.log('[PeerJS Cloud] Host watchdog: Initiating media call to guest...');
          const stream = await this.getReadyLocalStream();
          if (stream) {
            const call = this.peer.call(targetPeerId, stream);
            this.bindCallEvents(call, 'guest');
          }
        }
      }, 2800);
    });

    // Handle incoming media call
    this.peer.on('call', async (call) => {
      console.log('[PeerJS Cloud] Incoming video & voice call from:', call.peer);
      const stream = await this.getReadyLocalStream();
      console.log(`[PeerJS Cloud] Answering call with local stream (tracks: ${stream ? stream.getTracks().length : 0})...`);
      call.answer(stream);
      this.bindCallEvents(call, 'partner');
    });

    this.peer.on('error', (err) => {
      console.warn('[PeerJS Cloud] Peer error:', err.type, err.message);
      if (err.type === 'unavailable-id' && isCreator) {
        // Host ID already exists -> someone is already host in this room
        console.log('Room host already exists, joining as guest...');
        this.joinPeerJsRoom(roomId, false);
      }
    });
  }

  bindCallEvents(call, peerName = 'partner') {
    this.activeCall = call;

    call.on('stream', (remoteStream) => {
      console.log(`[PeerJS Cloud] >>> REMOTE MEDIA STREAM RECEIVED from ${peerName}! (tracks: ${remoteStream.getTracks().length})`);
      if (window.boothWebRTC) {
        window.boothWebRTC.handleRemoteStream(remoteStream);
      }
    });

    call.on('error', (err) => {
      console.warn(`[PeerJS Cloud] Call error with ${peerName}:`, err);
    });

    call.on('close', () => {
      console.log(`[PeerJS Cloud] Call closed with ${peerName}`);
      this.activeCall = null;
    });

    // Check underlying RTCPeerConnection if accessible
    if (call.peerConnection) {
      call.peerConnection.onconnectionstatechange = () => {
        console.log(`[PeerJS Cloud] Underlying WebRTC state: ${call.peerConnection.connectionState}`);
        if (window.boothWebRTC?.onConnectionStateChange) {
          window.boothWebRTC.onConnectionStateChange(call.peerConnection.connectionState);
        }
      };
    }
  }

  connectToPeer(targetPeerId) {
    console.log(`[PeerJS Cloud] Connecting data channel to target peer: ${targetPeerId}...`);
    const conn = this.peer.connect(targetPeerId, { reliable: true });
    this.setupPeerDataConnection(conn);

    conn.on('open', async () => {
      console.log('[PeerJS Cloud] Data channel opened with host');
      this.emit('peer_joined', {
        roomId: this.roomId,
        peerId: targetPeerId,
        peerName: 'Partner',
        shouldInitiateOffer: false
      });

      // Start media call to host
      const stream = await this.getReadyLocalStream();
      if (stream) {
        console.log(`[PeerJS Cloud] Calling host ${targetPeerId} with local video & audio stream...`);
        const call = this.peer.call(targetPeerId, stream);
        this.bindCallEvents(call, 'host');
      } else {
        console.warn('[PeerJS Cloud] Local stream not ready yet when calling host.');
      }
    });
  }

  setupPeerDataConnection(conn) {
    this.peerConn = conn;

    conn.on('data', (data) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        this.handleServerMessage(msg);
      } catch (err) {
        console.error('Failed to parse peer data:', err);
      }
    });

    conn.on('close', () => {
      console.log('[PeerJS Cloud] Partner disconnected');
      this.emit('peer_left', {
        roomId: this.roomId,
        message: 'Your partner has stepped out of the booth.'
      });
    });
  }

  send(type, payload = {}) {
    const message = {
      type,
      roomId: this.roomId,
      clientId: this.clientId,
      payload
    };

    if (this.mode === 'peerjs') {
      if (this.peerConn && this.peerConn.open) {
        this.peerConn.send(JSON.stringify(message));
      }
      return true;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.ws.send(JSON.stringify(message));
    return true;
  }

  sendSignal(signalData) {
    if (this.mode === 'websocket') {
      this.send('SIGNAL', signalData);
    }
  }

  triggerCountdown(shotMode = 'single', shotCount = 1, shotIndex = 0) {
    const msg = {
      type: 'SYNCED_COUNTDOWN_START',
      triggeredBy: this.clientId,
      shotMode,
      shotCount,
      shotIndex
    };

    if (this.mode === 'peerjs') {
      // Trigger locally immediately
      this.emit('countdown_start', msg);
      // Relay to partner
      this.send('TRIGGER_COUNTDOWN', { shotMode, shotCount, shotIndex });
      return;
    }

    this.send('TRIGGER_COUNTDOWN', { shotMode, shotCount, shotIndex });
  }

  cancelCountdown() {
    if (this.mode === 'peerjs') {
      this.emit('countdown_cancelled');
    }
    this.send('CANCEL_COUNTDOWN');
  }

  syncFilter(filterPreset, brightness, warmth, syncMode = true) {
    this.send('SYNC_FILTER', { filterPreset, brightness, warmth, syncMode });
  }

  syncFlashlight(active) {
    this.send('SYNC_FLASHLIGHT', { active });
  }

  syncStripConfig(config) {
    this.send('SYNC_STRIP_CONFIG', config);
  }

  sendReaction(emoji, x = 0.5, y = 0.5) {
    if (this.mode === 'peerjs') {
      this.emit('reaction_received', { emoji, x, y });
    }
    this.send('SEND_REACTION', { emoji, x, y });
  }

  handleServerMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'JOINED_SUCCESS':
        this.role = msg.role;
        this.emit('room_joined', msg);
        break;

      case 'ROOM_FULL':
        this.emit('room_full', msg);
        break;

      case 'PEER_JOINED':
        this.emit('peer_joined', msg);
        break;

      case 'PEER_LEFT':
        this.emit('peer_left', msg);
        break;

      case 'SIGNAL':
        this.emit('signal', msg.signalData);
        break;

      case 'TRIGGER_COUNTDOWN':
      case 'SYNCED_COUNTDOWN_START':
        this.emit('countdown_start', payload || msg);
        break;

      case 'CANCEL_COUNTDOWN':
      case 'SYNCED_COUNTDOWN_CANCELLED':
        this.emit('countdown_cancelled', payload || msg);
        break;

      case 'SYNC_FILTER':
      case 'FILTER_UPDATED':
        this.emit('filter_updated', payload || msg);
        break;

      case 'SYNC_FLASHLIGHT':
      case 'FLASHLIGHT_UPDATED':
        this.emit('flashlight_updated', payload || msg);
        break;

      case 'SYNC_STRIP_CONFIG':
      case 'STRIP_CONFIG_UPDATED':
        this.emit('strip_config_updated', payload || msg);
        break;

      case 'SEND_REACTION':
      case 'REACTION_RECEIVED':
        this.emit('reaction_received', payload || msg);
        break;

      default:
        console.log('Server/Peer message:', msg);
    }
  }
}

// Global signaling instance
window.boothSignaling = new BoothSignaling();
