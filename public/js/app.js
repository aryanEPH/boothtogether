/**
 * BoothTogether - Main Application Coordinator
 * Handles UI interactions, room pairing, synchronized shutter countdown,
 * screen flashlight mode, two-way live video call, and photo strip export modal.
 *
 * FIX LOG:
 * - Decouple peer_joined (shows "partner connected" badge) from actual video stream arrival
 *   (setPartnerStatusConnected(true) with video element only on onRemoteTrackReceived)
 * - In PeerJS mode, block native WebRTC createAndSendOffer from triggering
 * - Volume slider bound to webrtc.setPartnerVolume()
 * - Autoplay unlock click listener for mobile browser policy
 */

class BoothApp {
  constructor() {
    this.roomId = null;
    this.isPartnerSignalingConnected = false;  // Partner joined signaling (badge)
    this.isPartnerVideoLive = false;           // Partner video track is actually rendering
    this.isFlashlightOn = false;
    this.activeShotMode = 'strip3'; // 'single', 'strip3', 'strip4'
    this.countdownTimer = null;
    this.multiShotTimeout = null;
    this.isCapturing = false;

    // Subsystem references
    this.signaling = window.boothSignaling;
    this.webrtc = window.boothWebRTC;
    this.filters = window.filterManager;
    this.photostrip = window.photostripEngine;
    this.audio = window.boothAudio;
  }

  init() {
    console.log('Initializing BoothTogether Application...');
    this.bindDomEvents();
    this.setupSignalingEvents();
    this.setupWebRtcEvents();
    this.setupFilterEvents();
    this.checkUrlForRoom();
  }

  /**
   * Check if URL has a room code (?room=ABC123 or #ABC123)
   * When a partner receives a share link, they auto-join as guest (isCreator = false)
   */
  checkUrlForRoom() {
    const params = new URLSearchParams(window.location.search);
    let code = params.get('room');
    if (!code && window.location.hash) {
      code = window.location.hash.replace('#', '');
    }

    if (code && code.trim().length === 6) {
      const sanitized = code.trim().toUpperCase();
      console.log(`Auto-joining room from URL: ${sanitized} (as guest)`);
      this.joinBooth(sanitized, false); // Share link = join as guest
    }
  }

  /**
   * Generate friendly 6-character room code (excluding ambiguous chars 0 O 1 I)
   */
  generateRoomCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Bind all DOM event listeners
   */
  bindDomEvents() {
    // --- LANDING SCREEN ---
    const btnCreateRoom = document.getElementById('btn-create-booth');
    if (btnCreateRoom) {
      btnCreateRoom.addEventListener('click', () => {
        const newCode = this.generateRoomCode();
        this.showCreatedBoothCard(newCode);
      });
    }

    const btnJoinRoom = document.getElementById('btn-join-booth');
    const inputJoinCode = document.getElementById('input-room-code');
    if (btnJoinRoom && inputJoinCode) {
      btnJoinRoom.addEventListener('click', () => {
        const code = inputJoinCode.value.trim().toUpperCase();
        if (code.length === 6) {
          this.joinBooth(code, false); // Joining via input = guest
        } else {
          this.showToast('Please enter a valid 6-character room code.', 'error');
        }
      });

      inputJoinCode.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') btnJoinRoom.click();
      });

      // Auto-uppercase as the user types
      inputJoinCode.addEventListener('input', (e) => {
        const pos = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase();
        e.target.setSelectionRange(pos, pos);
      });
    }

    // Copy Link Buttons (delegated - multiple in DOM)
    document.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.btn-copy-link');
      if (copyBtn) {
        const codeToCopy = copyBtn.dataset.code || this.roomId;
        this.copyInviteLink(codeToCopy);
      }
    });

    // --- BOOTH NAVBAR CONTROLS ---

    // Screen Flashlight (Ring Light Mode)
    const btnFlashlight = document.getElementById('btn-flashlight-toggle');
    if (btnFlashlight) {
      btnFlashlight.addEventListener('click', () => this.toggleFlashlight());
    }

    // Microphone Mute Toggle
    const btnMute = document.getElementById('btn-mute-toggle');
    if (btnMute) {
      btnMute.addEventListener('click', () => {
        const isMuted = this.webrtc.toggleMute();
        btnMute.classList.toggle('active', isMuted);
        btnMute.title = isMuted ? 'Unmute Mic' : 'Mute Mic';
        const icon = btnMute.querySelector('.icon');
        if (icon) icon.textContent = isMuted ? '🔇' : '🎙️';
        this.showToast(isMuted ? '🔇 Microphone Muted' : '🎙️ Microphone Active');
      });
    }

    // Partner Voice Volume Slider
    const volumeSlider = document.getElementById('remote-volume-slider');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        this.webrtc.setPartnerVolume(Number(e.target.value));
      });
    }

    // Flip Camera (Mobile front/back switch)
    const btnFlip = document.getElementById('btn-flip-camera');
    if (btnFlip) {
      btnFlip.addEventListener('click', async () => {
        btnFlip.classList.add('spinning');
        await this.webrtc.flipCamera();
        setTimeout(() => btnFlip.classList.remove('spinning'), 500);
        this.showToast('Camera flipped!');
      });
    }

    // Reconnect Call Buttons (Navbar and inside Waiting Box)
    const btnReconnect = document.getElementById('btn-reconnect-call');
    if (btnReconnect) {
      btnReconnect.addEventListener('click', () => this.reconnectPartnerMedia());
    }

    const btnWaitingConnect = document.getElementById('btn-waiting-connect-now');
    if (btnWaitingConnect) {
      btnWaitingConnect.addEventListener('click', () => this.reconnectPartnerMedia());
    }

    const btnForceWebRtc = document.getElementById('btn-force-call-webrtc');
    if (btnForceWebRtc) {
      btnForceWebRtc.addEventListener('click', () => this.reconnectPartnerMedia());
    }

    const btnSwitchPeerJs = document.getElementById('btn-switch-peerjs');
    if (btnSwitchPeerJs) {
      btnSwitchPeerJs.addEventListener('click', () => this.signaling.requestSwitchToPeerJs());
    }

    // Exit Booth
    const btnExit = document.getElementById('btn-exit-booth');
    if (btnExit) {
      btnExit.addEventListener('click', () => {
        if (confirm('Leave this photobooth?')) {
          this.webrtc.cleanup();
          window.location.href = window.location.pathname;
        }
      });
    }

    // --- SHUTTER & CAPTURE ---

    const btnShutter = document.getElementById('btn-shutter');
    if (btnShutter) {
      btnShutter.addEventListener('click', () => {
        if (this.isCapturing) return;
        this.triggerShutterCountdown();
      });
    }

    const btnCancelCountdown = document.getElementById('btn-cancel-countdown');
    if (btnCancelCountdown) {
      btnCancelCountdown.addEventListener('click', () => {
        this.signaling.cancelCountdown();
        this.stopCountdown('Countdown cancelled');
      });
    }

    // Shot Mode Selector (Single, 3-Strip, 4-Strip)
    const shotModeButtons = document.querySelectorAll('.mode-chip');
    shotModeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        shotModeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeShotMode = btn.dataset.mode;
        this.signaling.syncStripConfig({ shotMode: this.activeShotMode });
      });
    });

    // --- FILTER CONTROLS ---

    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.filters.setPreset(chip.dataset.filter);
      });
    });

    const brightnessSlider = document.getElementById('brightness-slider');
    if (brightnessSlider) {
      brightnessSlider.addEventListener('input', (e) => {
        this.filters.setBrightness(e.target.value);
      });
    }

    const warmthSlider = document.getElementById('warmth-slider');
    if (warmthSlider) {
      warmthSlider.addEventListener('input', (e) => {
        this.filters.setWarmth(e.target.value);
      });
    }

    const syncFilterToggle = document.getElementById('sync-filter-toggle');
    if (syncFilterToggle) {
      syncFilterToggle.addEventListener('change', (e) => {
        this.filters.setSyncMode(e.target.checked);
      });
    }

    // --- LOVE REACTIONS ---

    const reactionButtons = document.querySelectorAll('.reaction-btn');
    reactionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji || '❤️';
        this.audio.playReactionPop();
        this.showFloatingReaction(emoji, 0.2 + Math.random() * 0.6, 0.3 + Math.random() * 0.4);
        this.signaling.sendReaction(emoji, 0.2 + Math.random() * 0.6, 0.3 + Math.random() * 0.4);
      });
    });

    // --- PHOTO STRIP MODAL ---

    const themeSwatches = document.querySelectorAll('.theme-swatch');
    themeSwatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        themeSwatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        this.photostrip.currentTheme = swatch.dataset.theme;
        this.updateStripPreview();
      });
    });

    const inputCaption = document.getElementById('strip-caption-input');
    if (inputCaption) {
      inputCaption.addEventListener('input', (e) => {
        this.photostrip.customCaption = e.target.value;
        this.updateStripPreview();
      });
    }

    const inputLocation = document.getElementById('strip-location-input');
    if (inputLocation) {
      inputLocation.addEventListener('input', (e) => {
        this.photostrip.locationTag = e.target.value;
        this.updateStripPreview();
      });
    }

    const stickerCheckboxes = document.querySelectorAll('.sticker-check');
    stickerCheckboxes.forEach(chk => {
      chk.addEventListener('change', () => {
        const active = [];
        stickerCheckboxes.forEach(c => { if (c.checked) active.push(c.value); });
        this.photostrip.activeStickers = active;
        this.updateStripPreview();
      });
    });

    const btnDownloadJpg = document.getElementById('btn-download-jpg');
    if (btnDownloadJpg) {
      btnDownloadJpg.addEventListener('click', () => {
        this.photostrip.downloadJpg(this.roomId);
        this.triggerConfetti();
        this.showToast('📥 Downloading Photo Strip JPG!');
      });
    }

    const btnDownloadPdf = document.getElementById('btn-download-pdf');
    if (btnDownloadPdf) {
      btnDownloadPdf.addEventListener('click', async () => {
        btnDownloadPdf.classList.add('loading');
        await this.photostrip.downloadPdf(this.roomId);
        btnDownloadPdf.classList.remove('loading');
        this.triggerConfetti();
        this.showToast('📄 Generating Print-Ready PDF!');
      });
    }

    const btnCopyImage = document.getElementById('btn-copy-image');
    if (btnCopyImage) {
      btnCopyImage.addEventListener('click', async () => {
        try {
          await this.photostrip.copyToClipboard();
          this.showToast('📋 Photo Strip copied to clipboard! Paste it anywhere 💕');
        } catch (err) {
          this.showToast('Clipboard copy failed — use Download JPG instead.', 'error');
        }
      });
    }

    const btnRetake = document.getElementById('btn-retake-strip');
    if (btnRetake) {
      btnRetake.addEventListener('click', () => this.closeStripModal());
    }

    // --- CAMERA PERMISSION FALLBACK ---

    const btnUseDemoMode = document.getElementById('btn-use-demo-mode');
    if (btnUseDemoMode) {
      btnUseDemoMode.addEventListener('click', () => {
        this.webrtc.startDemoStream();
        this.hidePermissionOverlay();
        this.showToast('Virtual test camera active!', 'info');
      });
    }

    const btnRetryCamera = document.getElementById('btn-retry-camera');
    if (btnRetryCamera) {
      btnRetryCamera.addEventListener('click', () => this.requestCameraAccess());
    }

    // --- AUTOPLAY UNLOCK & USER INTERACTION RESUME ---
    // Mobile browsers require a user gesture to start unmuted audio playback.
    // Listening to click, touchstart, and pointerdown ensures audio and video streams
    // resume instantly as soon as the user taps anywhere on the screen.
    const unlockMediaPlayback = () => {
      const remoteVideo = document.getElementById('remote-video');
      if (remoteVideo && remoteVideo.srcObject && remoteVideo.paused) {
        remoteVideo.muted = true;
        remoteVideo.play().catch(() => {});
      }
      const remoteAudio = document.getElementById('remote-audio');
      if (remoteAudio && remoteAudio.srcObject && remoteAudio.paused) {
        remoteAudio.play().then(() => {
          const unmuteBanner = document.getElementById('btn-unmute-call');
          if (unmuteBanner) unmuteBanner.classList.add('hidden');
        }).catch(() => {});
      }
    };

    document.addEventListener('click', unlockMediaPlayback, { passive: true });
    document.addEventListener('touchstart', unlockMediaPlayback, { passive: true });
    document.addEventListener('pointerdown', unlockMediaPlayback, { passive: true });
  }

  /**
   * Setup WebSocket signaling event handlers
   */
  setupSignalingEvents() {
    this.signaling.on('room_joined', (msg) => {
      console.log('Room joined:', msg);
      this.updateRoomBadge(msg.roomId);
      this.updateUserCount(msg.userCount);
    });

    this.signaling.on('room_full', (msg) => {
      alert(msg.message || 'This booth is full!');
      this.switchToLandingScreen();
    });

    this.signaling.on('peer_joined', async (msg) => {
      console.log('Partner joined signaling:', msg);
      this.isPartnerSignalingConnected = true;
      this.audio.playPartnerJoinedChime();
      this.showToast(`${msg.peerName || 'Your partner'} entered the booth! 💕`, 'success');

      // Update status badge — but do NOT show video yet (video comes via WebRTC track event)
      this.updatePartnerBadge(true, false);

      // Only trigger native WebRTC offer in WebSocket mode.
      // In PeerJS mode the media call is handled entirely by signaling.js → connectToPeer()
      if (this.signaling.mode !== 'peerjs' && msg.shouldInitiateOffer) {
        console.log('WebSocket mode: Creating WebRTC offer as initiator...');
        await this.webrtc.createAndSendOffer(this.signaling);
      }
    });

    this.signaling.on('peer_left', () => {
      console.log('Partner disconnected');
      this.isPartnerSignalingConnected = false;
      this.isPartnerVideoLive = false;
      this.showToast('Your partner stepped out of the booth.', 'info');
      this.updatePartnerBadge(false, false);
      this.hidePartnerVideo();
    });

    // Native WebRTC signaling relay (WebSocket mode only)
    this.signaling.on('signal', async (signalData) => {
      await this.webrtc.handleSignalingData(this.signaling, signalData);
    });

    // Synchronized countdown shutter
    this.signaling.on('countdown_start', (msg) => {
      this.runSyncedCountdownSequence(msg);
    });

    this.signaling.on('countdown_cancelled', () => {
      this.stopCountdown('Countdown cancelled by partner');
    });

    // Filter sync
    this.signaling.on('filter_updated', (msg) => {
      this.filters.handleRemoteFilterUpdate(msg);
    });

    // Flashlight sync
    this.signaling.on('flashlight_updated', (msg) => {
      const active = msg.active !== undefined ? msg.active : (msg.payload && msg.payload.active);
      if (active !== undefined && active !== this.isFlashlightOn) {
        this.toggleFlashlight(active, false);
      }
    });

    // Strip config sync
    this.signaling.on('strip_config_updated', (msg) => {
      const shotMode = msg.shotMode || (msg.config && msg.config.shotMode);
      if (shotMode) {
        this.activeShotMode = shotMode;
        document.querySelectorAll('.mode-chip').forEach(chip => {
          chip.classList.toggle('active', chip.dataset.mode === shotMode);
        });
      }
    });

    // Love reactions
    this.signaling.on('reaction_received', (msg) => {
      const emoji = msg.emoji || (msg.payload && msg.payload.emoji) || '❤️';
      const x = msg.x !== undefined ? msg.x : (msg.payload && msg.payload.x) || 0.5;
      const y = msg.y !== undefined ? msg.y : (msg.payload && msg.payload.y) || 0.5;
      this.showFloatingReaction(emoji, x, y);
    });

    this.signaling.on('error_message', (msg) => {
      this.showToast(typeof msg === 'string' ? msg : (msg.message || 'Connection error'), 'error');
    });
  }

  /**
   * Setup WebRTC event callbacks.
   * onRemoteTrackReceived fires when the actual video/audio track arrives —
   * this is the correct moment to show the remote video element.
   */
  setupWebRtcEvents() {
    this.webrtc.onRemoteTrackReceived = (stream) => {
      console.log('>>> WebRTC remote stream received! Showing partner video.');
      this.isPartnerVideoLive = true;
      this.updatePartnerBadge(true, true);
      this.showPartnerVideo();
    };

    this.webrtc.onConnectionStateChange = (state) => {
      console.log('WebRTC connection state changed to:', state);
      const partnerPill = document.getElementById('partner-status-badge');

      if (state === 'connected') {
        this.showToast('🟢 Video call connected!', 'success');
        if (partnerPill) {
          partnerPill.innerHTML = '<span class="status-dot green"></span> Live Call 🎥';
        }
      } else if (state === 'disconnected' || state === 'failed') {
        if (partnerPill) {
          partnerPill.innerHTML = '<span class="status-dot red"></span> Reconnecting...';
        }
      } else if (state === 'closed') {
        this.isPartnerVideoLive = false;
        this.updatePartnerBadge(this.isPartnerSignalingConnected, false);
        this.hidePartnerVideo();
      }
    };
  }

  setupFilterEvents() {
    this.filters.onLocalFilterChanged = (state) => {
      if (this.roomId && state.syncMode) {
        this.signaling.syncFilter(state.preset, state.brightness, state.warmth, true);
      }
    };
  }

  /**
   * Display the newly created booth card with share link
   */
  showCreatedBoothCard(roomCode) {
    const card = document.getElementById('created-room-card');
    const codeDisplay = document.getElementById('created-room-code');
    const btnEnter = document.getElementById('btn-enter-created-booth');

    if (codeDisplay) codeDisplay.textContent = roomCode;
    if (card) card.classList.remove('hidden');

    const copyBtn = card ? card.querySelector('.btn-copy-link') : null;
    if (copyBtn) copyBtn.dataset.code = roomCode;

    if (btnEnter) {
      btnEnter.onclick = () => this.joinBooth(roomCode, true);
    }
  }

  /**
   * Enter Booth: transition UI, start camera, connect signaling.
   * isCreator = true  → "Create a Booth" button (PeerJS host peer ID)
   * isCreator = false → "Join a Booth" / share link (PeerJS guest peer ID)
   */
  async joinBooth(roomCode, isCreator = false) {
    this.roomId = roomCode;
    window.location.hash = roomCode;

    document.getElementById('landing-screen').classList.add('hidden');
    document.getElementById('booth-screen').classList.remove('hidden');

    this.updateRoomBadge(roomCode);
    this.updatePartnerBadge(false, false);
    this.hidePartnerVideo();

    this.audio.init();

    // Start local camera + mic
    await this.requestCameraAccess();

    // Connect to signaling (WebSocket on local/Render, PeerJS on GitHub Pages)
    try {
      await this.signaling.connect();
      this.signaling.joinRoom(roomCode, 'Partner', isCreator);
    } catch (err) {
      console.error('Signaling connection error:', err);
      this.showToast('Connection error. Try refreshing both devices.', 'error');
    }
  }

  /**
   * Request webcam + mic with graceful fallback
   */
  async requestCameraAccess() {
    try {
      this.hidePermissionOverlay();
      await this.webrtc.startLocalMedia();
      this.filters.applyFilters();
    } catch (err) {
      console.warn('Camera/Mic access failed:', err);
      this.showPermissionOverlay();
    }
  }

  showPermissionOverlay() {
    const overlay = document.getElementById('permission-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  hidePermissionOverlay() {
    const overlay = document.getElementById('permission-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  /**
   * Copy Booth Invite Link to clipboard
   */
  copyInviteLink(code) {
    if (!code) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    navigator.clipboard.writeText(url).then(() => {
      this.showToast(`Booth link copied! Send it to your partner 💕`, 'success');
    }).catch(() => {
      prompt('Copy this booth invite link:', url);
    });
  }

  /**
   * Toggle Screen Flashlight (Beauty Ring Light) Mode
   */
  toggleFlashlight(forceState = null, notifyPartner = true) {
    this.isFlashlightOn = forceState !== null ? forceState : !this.isFlashlightOn;

    document.body.classList.toggle('flashlight-mode', this.isFlashlightOn);
    const wrapper = document.getElementById('flashlight-wrapper');
    if (wrapper) wrapper.classList.toggle('flashlight-active', this.isFlashlightOn);

    const btn = document.getElementById('btn-flashlight-toggle');
    if (btn) {
      btn.classList.toggle('active', this.isFlashlightOn);
      btn.title = this.isFlashlightOn ? 'Turn Off Ring Light' : 'Turn On Screen Flashlight (Ring Light)';
    }

    if (notifyPartner && this.roomId) {
      this.signaling.syncFlashlight(this.isFlashlightOn);
    }

    this.showToast(this.isFlashlightOn
      ? '💡 Ring Light ON — illuminating your face!'
      : '🌙 Ring Light OFF');
  }

  /**
   * Trigger shutter countdown
   */
  triggerShutterCountdown() {
    if (this.isCapturing) return;
    this.photostrip.reset();
    const shotCount = this.activeShotMode === 'strip4' ? 4 : (this.activeShotMode === 'strip3' ? 3 : 1);
    this.signaling.triggerCountdown(this.activeShotMode, shotCount, 0);
  }

  /**
   * Run synchronized countdown sequence (called on BOTH devices simultaneously)
   */
  async runSyncedCountdownSequence(msg) {
    if (this.isCapturing && (msg.shotIndex || 0) === 0) return; // Avoid double-trigger on first shot
    this.isCapturing = true;

    const shotMode = msg.shotMode || this.activeShotMode;
    const shotCount = msg.shotCount || 1;
    const shotIndex = msg.shotIndex || 0;

    const overlay = document.getElementById('countdown-overlay');
    const numberDisplay = document.getElementById('countdown-number');
    const badgeDisplay = document.getElementById('countdown-shot-badge');

    if (overlay) overlay.classList.remove('hidden');
    if (badgeDisplay) {
      badgeDisplay.textContent = shotCount > 1
        ? `Pose ${shotIndex + 1} of ${shotCount}`
        : '📸 Dual Snapshot';
    }

    // 3... 2... 1...
    for (let count = 3; count >= 1; count--) {
      if (numberDisplay) {
        numberDisplay.textContent = count;
        numberDisplay.classList.remove('pulse-anim');
        void numberDisplay.offsetWidth; // force reflow for re-animation
        numberDisplay.classList.add('pulse-anim');
      }
      this.audio.playCountdownBeep(count === 1);
      await this.sleep(1000);
      if (!this.isCapturing) return; // Cancelled mid-countdown
    }

    // SMILE!
    if (numberDisplay) numberDisplay.textContent = 'SMILE! 📸';
    this.triggerFlashAndCapture(shotIndex + 1, shotCount);

    await this.sleep(600);
    if (overlay) overlay.classList.add('hidden');

    // Multi-shot: continue to next pose
    const nextIndex = shotIndex + 1;
    if (nextIndex < shotCount) {
      this.showPosePrepBanner(nextIndex + 1, shotCount);
      await this.sleep(2200);
      this.hidePosePrepBanner();

      // Only the person who first pressed SNAP re-triggers to stay in sync
      if (this.signaling.role === 'initiator' || !this.isPartnerSignalingConnected) {
        this.signaling.triggerCountdown(shotMode, shotCount, nextIndex);
      }
    } else {
      this.isCapturing = false;
      this.openStripModal();
    }
  }

  /**
   * Flash screen white, play shutter sound, capture frame from both video elements
   */
  triggerFlashAndCapture(shotNum, totalShots) {
    this.audio.playShutterSound();

    const flashEl = document.getElementById('flash-screen');
    if (flashEl) {
      flashEl.classList.remove('flash-anim');
      void flashEl.offsetWidth;
      flashEl.classList.add('flash-anim');
    }

    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    this.photostrip.captureCurrentFrame(localVideo, remoteVideo, this.filters);

    this.showToast(`📸 Pose ${shotNum} of ${totalShots} captured!`, 'success');
  }

  showPosePrepBanner(nextPose, totalPoses) {
    const banner = document.getElementById('prep-banner');
    if (banner) {
      banner.textContent = `✨ Get ready for Pose ${nextPose} of ${totalPoses}!`;
      banner.classList.remove('hidden');
    }
  }

  hidePosePrepBanner() {
    const banner = document.getElementById('prep-banner');
    if (banner) banner.classList.add('hidden');
  }

  stopCountdown(reason = '') {
    this.isCapturing = false;
    clearTimeout(this.countdownTimer);
    clearTimeout(this.multiShotTimeout);
    const overlay = document.getElementById('countdown-overlay');
    if (overlay) overlay.classList.add('hidden');
    this.hidePosePrepBanner();
    if (reason) this.showToast(reason, 'info');
  }

  /**
   * Open Photo Strip modal and render the composite
   */
  openStripModal() {
    this.updateStripPreview();
    const modal = document.getElementById('strip-modal');
    if (modal) modal.classList.remove('hidden');
    this.triggerConfetti();
  }

  closeStripModal() {
    const modal = document.getElementById('strip-modal');
    if (modal) modal.classList.add('hidden');
    this.isCapturing = false;
  }

  updateStripPreview() {
    const previewContainer = document.getElementById('strip-canvas-container');
    if (!previewContainer) return;

    const renderedCanvas = this.photostrip.renderStrip({
      roomId: this.roomId || 'BOOTH',
      theme: this.photostrip.currentTheme
    });

    previewContainer.innerHTML = '';
    renderedCanvas.className = 'rendered-strip-preview';
    previewContainer.appendChild(renderedCanvas);
  }

  /**
   * Show floating emoji reaction on screen
   */
  showFloatingReaction(emoji, xPct, yPct) {
    const container = document.getElementById('reactions-layer');
    if (!container) return;

    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    el.style.left = `${Math.round(xPct * 100)}%`;
    el.style.top = `${Math.round(yPct * 100)}%`;
    container.appendChild(el);

    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2800);
  }

  triggerConfetti() {
    if (window.confetti) {
      window.confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#E05A47', '#FF7E67', '#FFE4E6', '#F59E0B', '#FFFDF8']
      });
    }
  }

  // ─── UI State Helpers ─────────────────────────────────────────────────────

  /**
   * Update live connection diagnostic panel
   */
  setDiag(key, text, status = '') {
    const elMap = {
      signaling: 'diag-signaling-val',
      offer: 'diag-offer-val',
      answer: 'diag-answer-val',
      ice: 'diag-ice-val',
      media: 'diag-media-val',
      engine: 'diag-engine-badge'
    };
    const id = elMap[key];
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;

    if (key === 'engine') {
      el.textContent = `Engine: ${text}`;
      return;
    }

    el.textContent = text;
    el.className = 'diag-val';
    if (status) el.classList.add(status);
  }

  /**
   * Update the partner status badge in the top nav and waiting card.
   */
  updatePartnerBadge(signalingConnected, videoLive) {
    const partnerPill = document.getElementById('partner-status-badge');
    const reconnectBtn = document.getElementById('btn-reconnect-call');
    const waitingTitle = document.getElementById('waiting-status-title');
    const waitingDesc = document.getElementById('waiting-status-desc');
    const waitingCopy = document.getElementById('btn-waiting-copy');
    const waitingConnectBtn = document.getElementById('btn-waiting-connect-now');
    const waitingIcon = document.getElementById('waiting-icon');
    const diagPanel = document.getElementById('connection-diag-panel');

    if (videoLive) {
      if (partnerPill) partnerPill.innerHTML = '<span class="status-dot green"></span> Live Call 🎥';
      if (reconnectBtn) reconnectBtn.classList.add('hidden');
      if (diagPanel) diagPanel.classList.add('hidden');
      this.setDiag('media', 'Live Video & Audio Connected! 🎥', 'ok');
    } else if (signalingConnected) {
      if (partnerPill) partnerPill.innerHTML = '<span class="status-dot yellow"></span> Partner in Booth 💕';
      if (reconnectBtn) reconnectBtn.classList.remove('hidden');

      if (waitingTitle) waitingTitle.textContent = 'Partner in Booth! Connecting... 💕';
      if (waitingDesc) waitingDesc.textContent = 'Establishing secure P2P video & voice stream...';
      if (waitingCopy) waitingCopy.classList.add('hidden');
      if (waitingConnectBtn) waitingConnectBtn.classList.remove('hidden');
      if (waitingIcon) waitingIcon.textContent = '🎥';
      if (diagPanel) diagPanel.classList.remove('hidden');

      this.setDiag('signaling', 'Connected (Partner in Room)', 'ok');
      this.setDiag('engine', this.signaling.mode === 'peerjs' ? 'PeerJS Cloud' : 'WebSocket', 'ok');

      // Auto-fallback watchdog: if still not live after 6 seconds, automatically switch to PeerJS Cloud
      clearTimeout(this.mediaFallbackTimeout);
      this.mediaFallbackTimeout = setTimeout(() => {
        if (!this.isPartnerVideoLive && this.signaling.mode === 'websocket') {
          console.warn('Direct WebRTC took >6s across network firewall. Auto-switching to PeerJS Cloud Relay...');
          this.setDiag('ice', 'Direct P2P stalled. Auto-switching to Cloud Relay...', 'err');
          this.signaling.requestSwitchToPeerJs();
        }
      }, 6000);
    } else {
      if (partnerPill) partnerPill.innerHTML = '<span class="status-dot yellow"></span> Waiting for Partner';
      if (reconnectBtn) reconnectBtn.classList.add('hidden');
      if (diagPanel) diagPanel.classList.add('hidden');

      if (waitingTitle) waitingTitle.textContent = 'Waiting for Your Partner';
      if (waitingDesc) waitingDesc.textContent = 'Send them the room code or click below to copy the direct link:';
      if (waitingCopy) waitingCopy.classList.remove('hidden');
      if (waitingConnectBtn) waitingConnectBtn.classList.add('hidden');
      if (waitingIcon) waitingIcon.textContent = '💌';
    }
  }

  /**
   * Show the partner video element and hide the waiting placeholder
   */
  showPartnerVideo() {
    const placeholder = document.getElementById('remote-waiting-placeholder');
    const remoteVideo = document.getElementById('remote-video');
    const remoteAudio = document.getElementById('remote-audio');
    const reconnectBtn = document.getElementById('btn-reconnect-call');

    if (placeholder) {
      placeholder.classList.add('hidden');
      placeholder.style.display = 'none';
    }
    if (remoteVideo) {
      remoteVideo.classList.remove('hidden');
      remoteVideo.style.display = 'block';
      remoteVideo.muted = true;
      remoteVideo.play().catch(() => {});
    }
    if (remoteAudio && remoteAudio.srcObject && remoteAudio.paused) {
      remoteAudio.play().catch(() => {});
    }
    if (reconnectBtn) {
      reconnectBtn.classList.add('hidden');
    }
  }

  /**
   * Hide the partner video and show the waiting placeholder
   */
  hidePartnerVideo() {
    const placeholder = document.getElementById('remote-waiting-placeholder');
    const remoteVideo = document.getElementById('remote-video');
    const remoteAudio = document.getElementById('remote-audio');
    const unmuteBanner = document.getElementById('btn-unmute-call');

    if (placeholder) {
      placeholder.classList.remove('hidden');
      placeholder.style.display = 'flex';
    }
    if (remoteVideo) {
      remoteVideo.classList.add('hidden');
      remoteVideo.style.display = 'none';
      remoteVideo.srcObject = null;
    }
    if (remoteAudio) remoteAudio.srcObject = null;
    if (unmuteBanner) unmuteBanner.classList.add('hidden');
  }

  /**
   * Manually trigger re-negotiation if network or firewall stalled
   */
  async reconnectPartnerMedia() {
    this.showToast('🔄 Reconnecting video & voice stream...', 'info');
    console.log('Manual media reconnect triggered...');
    if (this.signaling.mode === 'websocket') {
      await this.webrtc.createAndSendOffer(this.signaling);
    } else if (this.signaling.mode === 'peerjs') {
      this.signaling.activeCall = null;
      const targetId = this.signaling.role === 'initiator'
        ? `bt_${this.roomId.toLowerCase()}_guest`
        : `bt_${this.roomId.toLowerCase()}_host`;
      const stream = await this.signaling.getReadyLocalStream();
      if (stream && this.signaling.peer) {
        const call = this.signaling.peer.call(targetId, stream);
        this.signaling.bindCallEvents(call, 'partner');
      }
    }
  }

  updateRoomBadge(roomId) {
    document.querySelectorAll('.room-code-badge').forEach(b => {
      b.textContent = `#${roomId}`;
    });
  }

  updateUserCount(count) {
    const el = document.getElementById('booth-capacity-pill');
    if (el) el.textContent = `${count} / 2 in Booth`;
  }

  switchToLandingScreen() {
    document.getElementById('booth-screen').classList.add('hidden');
    document.getElementById('landing-screen').classList.remove('hidden');
    window.location.hash = '';
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `booth-toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, 3200);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.boothApp = new BoothApp();
  window.boothApp.init();
});
