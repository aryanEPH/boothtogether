/**
 * BoothTogether - Main Application Coordinator
 * Handles UI interactions, room pairing, synchronized shutter countdown,
 * screen flashlight mode, and photo strip export modal.
 */

class BoothApp {
  constructor() {
    this.roomId = null;
    this.isPartnerConnected = false;
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
   */
  checkUrlForRoom() {
    const params = new URLSearchParams(window.location.search);
    let code = params.get('room');
    if (!code && window.location.hash) {
      code = window.location.hash.replace('#', '');
    }

    if (code && code.trim().length === 6) {
      const sanitized = code.trim().toUpperCase();
      console.log(`Auto-joining room from URL: ${sanitized}`);
      this.joinBooth(sanitized);
    }
  }

  /**
   * Generate friendly 6-character room code (avoiding confusing chars like 0, O, 1, I)
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
   * Bind DOM event listeners
   */
  bindDomEvents() {
    // 1. Landing Screen Events
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
          this.joinBooth(code, false);
        } else {
          this.showToast('Please enter a valid 6-character room code.', 'error');
        }
      });

      inputJoinCode.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
          btnJoinRoom.click();
        }
      });
    }

    // Copy Link Buttons
    document.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.btn-copy-link');
      if (copyBtn) {
        const codeToCopy = copyBtn.dataset.code || this.roomId;
        this.copyInviteLink(codeToCopy);
      }
    });

    // 2. Screen Flashlight (Ring Light Mode) Toggle
    const btnFlashlight = document.getElementById('btn-flashlight-toggle');
    if (btnFlashlight) {
      btnFlashlight.addEventListener('click', () => {
        this.toggleFlashlight();
      });
    }

    // 3. Audio Mute Toggle
    const btnMute = document.getElementById('btn-mute-toggle');
    if (btnMute) {
      btnMute.addEventListener('click', () => {
        const isMuted = this.webrtc.toggleMute();
        btnMute.classList.toggle('active', isMuted);
        btnMute.title = isMuted ? 'Unmute Mic' : 'Mute Mic';
        const icon = btnMute.querySelector('.icon');
        if (icon) icon.textContent = isMuted ? '🔇' : '🎙️';
        this.showToast(isMuted ? 'Microphone Muted' : 'Microphone Active');
      });
    }

    // 4. Flip Camera (Mobile)
    const btnFlip = document.getElementById('btn-flip-camera');
    if (btnFlip) {
      btnFlip.addEventListener('click', async () => {
        btnFlip.classList.add('spinning');
        await this.webrtc.flipCamera();
        btnFlip.classList.remove('spinning');
        this.showToast('Camera flipped');
      });
    }

    // 5. Exit Booth / Back to Landing
    const btnExit = document.getElementById('btn-exit-booth');
    if (btnExit) {
      btnExit.addEventListener('click', () => {
        if (confirm('Leave this photobooth?')) {
          window.location.href = window.location.pathname;
        }
      });
    }

    // 6. Shutter Button & Mode Selectors
    const btnShutter = document.getElementById('btn-shutter');
    if (btnShutter) {
      btnShutter.addEventListener('click', () => {
        if (this.isCapturing) return;
        this.triggerShutterCountdown();
      });
    }

    // Cancel Countdown Button
    const btnCancelCountdown = document.getElementById('btn-cancel-countdown');
    if (btnCancelCountdown) {
      btnCancelCountdown.addEventListener('click', () => {
        this.signaling.cancelCountdown();
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

    // 7. Filter Controls (Presets & Brightness Slider)
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

    // 8. Love Reactions Bar (Hearts, Sparkles, Kisses)
    const reactionButtons = document.querySelectorAll('.reaction-btn');
    reactionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji || '❤️';
        this.audio.playReactionPop();
        this.signaling.sendReaction(emoji, 0.2 + Math.random() * 0.6, 0.3 + Math.random() * 0.4);
      });
    });

    // 9. Photo Strip Customization Modal Controls
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

    // Sticker checkboxes
    const stickerCheckboxes = document.querySelectorAll('.sticker-check');
    stickerCheckboxes.forEach(chk => {
      chk.addEventListener('change', () => {
        const active = [];
        stickerCheckboxes.forEach(c => {
          if (c.checked) active.push(c.value);
        });
        this.photostrip.activeStickers = active;
        this.updateStripPreview();
      });
    });

    // Export Action Buttons
    const btnDownloadJpg = document.getElementById('btn-download-jpg');
    if (btnDownloadJpg) {
      btnDownloadJpg.addEventListener('click', () => {
        this.photostrip.downloadJpg(this.roomId);
        this.triggerConfetti();
        this.showToast('Downloading Photo Strip JPG! ✨');
      });
    }

    const btnDownloadPdf = document.getElementById('btn-download-pdf');
    if (btnDownloadPdf) {
      btnDownloadPdf.addEventListener('click', async () => {
        btnDownloadPdf.classList.add('loading');
        await this.photostrip.downloadPdf(this.roomId);
        btnDownloadPdf.classList.remove('loading');
        this.triggerConfetti();
        this.showToast('Generating Print-Ready PDF! 📄');
      });
    }

    const btnCopyImage = document.getElementById('btn-copy-image');
    if (btnCopyImage) {
      btnCopyImage.addEventListener('click', async () => {
        try {
          await this.photostrip.copyToClipboard();
          this.showToast('Photo Strip copied to clipboard! Ready to paste 💕');
        } catch (err) {
          this.showToast('Clipboard copy failed. Please use Download JPG.', 'error');
        }
      });
    }

    const btnRetake = document.getElementById('btn-retake-strip');
    if (btnRetake) {
      btnRetake.addEventListener('click', () => {
        this.closeStripModal();
      });
    }

    // Fallback / Demo Mode Toggle
    const btnUseDemoMode = document.getElementById('btn-use-demo-mode');
    if (btnUseDemoMode) {
      btnUseDemoMode.addEventListener('click', () => {
        this.webrtc.startDemoStream();
        this.hidePermissionOverlay();
        this.showToast('Virtual test camera active! Ready to test.', 'info');
      });
    }

    const btnRetryCamera = document.getElementById('btn-retry-camera');
    if (btnRetryCamera) {
      btnRetryCamera.addEventListener('click', () => {
        this.requestCameraAccess();
      });
    }
  }

  /**
   * Setup WebSocket signaling event handlers
   */
  setupSignalingEvents() {
    this.signaling.on('room_joined', (msg) => {
      console.log('Room joined successfully:', msg);
      this.updateRoomBadge(msg.roomId);
      this.updateUserCount(msg.userCount);
    });

    this.signaling.on('room_full', (msg) => {
      alert(msg.message);
      this.switchToLandingScreen();
    });

    this.signaling.on('peer_joined', async (msg) => {
      console.log('Peer joined booth:', msg);
      this.isPartnerConnected = true;
      this.audio.playPartnerJoinedChime();
      this.showToast(`${msg.peerName || 'Your partner'} entered the booth! 💕`, 'success');
      this.setPartnerStatusConnected(true);

      // If initiator, create WebRTC offer
      if (msg.shouldInitiateOffer) {
        await this.webrtc.createAndSendOffer(this.signaling);
      }
    });

    this.signaling.on('peer_left', (msg) => {
      console.log('Partner left booth:', msg);
      this.isPartnerConnected = false;
      this.showToast('Your partner stepped out of the booth.', 'info');
      this.setPartnerStatusConnected(false);
    });

    this.signaling.on('signal', async (signalData) => {
      await this.webrtc.handleSignalingData(this.signaling, signalData);
    });

    // Synchronized Countdown Shutter
    this.signaling.on('countdown_start', (msg) => {
      this.runSyncedCountdownSequence(msg);
    });

    this.signaling.on('countdown_cancelled', () => {
      this.stopCountdown('Countdown cancelled');
    });

    // Sync partner state updates
    this.signaling.on('filter_updated', (msg) => {
      this.filters.handleRemoteFilterUpdate(msg);
    });

    this.signaling.on('flashlight_updated', (msg) => {
      if (msg.active !== this.isFlashlightOn) {
        this.toggleFlashlight(msg.active, false); // Don't bounce back
      }
    });

    this.signaling.on('strip_config_updated', (msg) => {
      if (msg.config?.shotMode) {
        this.activeShotMode = msg.config.shotMode;
        document.querySelectorAll('.mode-chip').forEach(chip => {
          chip.classList.toggle('active', chip.dataset.mode === this.activeShotMode);
        });
      }
    });

    this.signaling.on('reaction_received', (msg) => {
      this.showFloatingReaction(msg.emoji, msg.x, msg.y);
    });

    this.signaling.on('error_message', (msg) => {
      this.showToast(msg, 'error');
    });
  }

  setupWebRtcEvents() {
    this.webrtc.onRemoteTrackReceived = () => {
      console.log('WebRTC Remote track connected to video');
      this.setPartnerStatusConnected(true);
    };

    this.webrtc.onConnectionStateChange = (state) => {
      const connPill = document.getElementById('connection-status-pill');
      if (connPill) {
        if (state === 'connected') {
          connPill.innerHTML = '<span class="status-dot green"></span> Live';
        } else if (state === 'connecting') {
          connPill.innerHTML = '<span class="status-dot yellow"></span> Connecting...';
        } else if (state === 'disconnected' || state === 'failed') {
          connPill.innerHTML = '<span class="status-dot red"></span> Disconnected';
        }
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

    const copyBtn = card.querySelector('.btn-copy-link');
    if (copyBtn) copyBtn.dataset.code = roomCode;

    if (btnEnter) {
      btnEnter.onclick = () => {
        this.joinBooth(roomCode, true);
      };
    }
  }

  /**
   * Enter Booth Screen and establish connection
   */
  async joinBooth(roomCode, isCreator = false) {
    this.roomId = roomCode;
    window.location.hash = roomCode;

    // Transition UI
    document.getElementById('landing-screen').classList.add('hidden');
    document.getElementById('booth-screen').classList.remove('hidden');

    this.updateRoomBadge(roomCode);
    this.setPartnerStatusConnected(false);

    // Initialize Web Audio context on user gesture
    this.audio.init();

    // Start Camera Feed
    await this.requestCameraAccess();

    // Connect to WebSocket signaling server (or PeerJS cloud on GitHub Pages)
    try {
      await this.signaling.connect();
      this.signaling.joinRoom(roomCode, 'Partner', isCreator);
    } catch (err) {
      console.error('Signaling connection error:', err);
      this.showToast('Could not connect to signaling server. Operating in offline demo mode.', 'error');
    }
  }

  /**
   * Request webcam access with fallback overlay
   */
  async requestCameraAccess() {
    try {
      this.hidePermissionOverlay();
      await this.webrtc.startLocalMedia();
      this.filters.applyFilters();
    } catch (err) {
      console.warn('Camera permission denied or not available:', err);
      this.showPermissionOverlay(err);
    }
  }

  showPermissionOverlay(err) {
    const overlay = document.getElementById('permission-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  hidePermissionOverlay() {
    const overlay = document.getElementById('permission-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  /**
   * Copy Booth Invite Link
   */
  copyInviteLink(code) {
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    navigator.clipboard.writeText(url).then(() => {
      this.showToast(`Booth link copied! Send it to your partner 💕`, 'success');
    }).catch(() => {
      // Fallback
      prompt('Copy this booth invite link:', url);
    });
  }

  /**
   * Toggle Screen Flashlight Mode (Ring Light)
   */
  toggleFlashlight(forceState = null, notifyPartner = true) {
    this.isFlashlightOn = forceState !== null ? forceState : !this.isFlashlightOn;

    document.body.classList.toggle('flashlight-mode', this.isFlashlightOn);
    const wrapper = document.getElementById('flashlight-wrapper');
    if (wrapper) {
      wrapper.classList.toggle('flashlight-active', this.isFlashlightOn);
    }

    const btn = document.getElementById('btn-flashlight-toggle');
    if (btn) {
      btn.classList.toggle('active', this.isFlashlightOn);
      btn.title = this.isFlashlightOn ? 'Turn Off Screen Flashlight' : 'Turn On Screen Flashlight (Ring Light)';
    }

    if (notifyPartner && this.roomId) {
      this.signaling.syncFlashlight(this.isFlashlightOn);
    }

    this.showToast(this.isFlashlightOn ? '💡 Ring Light Mode: ON (Illuminating your face)' : '🌙 Ring Light Mode: OFF');
  }

  /**
   * Start Shutter Countdown (Single or Multi-Shot)
   */
  triggerShutterCountdown() {
    if (this.isCapturing) return;

    // Reset captured shots
    this.photostrip.reset();

    const shotCount = this.activeShotMode === 'strip4' ? 4 : (this.activeShotMode === 'strip3' ? 3 : 1);
    this.signaling.triggerCountdown(this.activeShotMode, shotCount, 0);
  }

  /**
   * Execute Synced Countdown Sequence
   */
  async runSyncedCountdownSequence(msg) {
    this.isCapturing = true;
    const { shotMode, shotCount, shotIndex } = msg;

    const overlay = document.getElementById('countdown-overlay');
    const numberDisplay = document.getElementById('countdown-number');
    const badgeDisplay = document.getElementById('countdown-shot-badge');

    if (overlay) overlay.classList.remove('hidden');
    if (badgeDisplay) {
      badgeDisplay.textContent = shotCount > 1 ? `Pose ${shotIndex + 1} of ${shotCount}` : 'Dual Snapshot';
    }

    // Countdown: 3, 2, 1
    for (let count = 3; count >= 1; count--) {
      if (numberDisplay) {
        numberDisplay.textContent = count;
        numberDisplay.classList.remove('pulse-anim');
        void numberDisplay.offsetWidth; // Trigger reflow
        numberDisplay.classList.add('pulse-anim');
      }
      this.audio.playCountdownBeep(count === 1);
      await this.sleep(1000);
      if (!this.isCapturing) return; // Cancelled
    }

    // SMILE!
    if (numberDisplay) {
      numberDisplay.textContent = 'SMILE! 📸';
    }

    // Flash & Shutter
    this.triggerFlashAndCapture(shotIndex + 1, shotCount);

    await this.sleep(600);
    if (overlay) overlay.classList.add('hidden');

    // Handle Next Shot in Multi-Shot sequence
    const nextIndex = shotIndex + 1;
    if (nextIndex < shotCount) {
      // Show brief 2-second preparation pause between shots
      this.showPosePrepBanner(nextIndex + 1, shotCount);
      await this.sleep(2000);
      this.hidePosePrepBanner();

      // Trigger next shot
      if (this.signaling.role === 'initiator' || !this.isPartnerConnected) {
        this.signaling.triggerCountdown(shotMode, shotCount, nextIndex);
      }
    } else {
      // All shots completed! Open strip preview modal
      this.isCapturing = false;
      this.openStripModal();
    }
  }

  /**
   * Flash Screen and snapshot both video frames onto canvas
   */
  triggerFlashAndCapture(shotNum, totalShots) {
    // 1. Shutter Sound
    this.audio.playShutterSound();

    // 2. Fullscreen flash animation
    const flashEl = document.getElementById('flash-screen');
    if (flashEl) {
      flashEl.classList.remove('flash-anim');
      void flashEl.offsetWidth;
      flashEl.classList.add('flash-anim');
    }

    // 3. Grab pixels from local and remote videos
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    this.photostrip.captureCurrentFrame(localVideo, remoteVideo, this.filters);

    this.showToast(`📸 Captured Pose ${shotNum} of ${totalShots}!`, 'success');
  }

  showPosePrepBanner(nextPose, totalPoses) {
    const banner = document.getElementById('prep-banner');
    if (banner) {
      banner.textContent = `Get ready for Pose ${nextPose} of ${totalPoses}! 💕`;
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
   * Open the Photo Strip Customization & Export Modal
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
   * Show floating love reactions across both screens
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
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }, 2800);
  }

  /**
   * Confetti celebration
   */
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

  // UI State helpers
  setPartnerStatusConnected(connected) {
    const placeholder = document.getElementById('remote-waiting-placeholder');
    const remoteVideo = document.getElementById('remote-video');
    const partnerPill = document.getElementById('partner-status-badge');

    if (placeholder) placeholder.classList.toggle('hidden', connected);
    if (remoteVideo) remoteVideo.classList.toggle('hidden', !connected);
    if (partnerPill) {
      partnerPill.innerHTML = connected
        ? '<span class="status-dot green"></span> Partner Connected 💕'
        : '<span class="status-dot yellow"></span> Waiting for Partner';
    }
  }

  updateRoomBadge(roomId) {
    const badges = document.querySelectorAll('.room-code-badge');
    badges.forEach(b => b.textContent = `#${roomId}`);
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
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `booth-toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

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
