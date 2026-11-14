/**
 * BoothTogether - Live Camera Filters & Color Grading
 * Real-time CSS filter matrix & Canvas rendering calculations.
 */

const BOOTH_FILTERS = {
  natural: {
    id: 'natural',
    name: 'Natural',
    tag: 'Crisp & Clean',
    css: 'brightness(1) contrast(1) saturate(1)',
    description: 'Authentic camera look with true colors.'
  },
  golden: {
    id: 'golden',
    name: 'Warm Golden Hour',
    tag: 'Sunset Glow',
    css: 'brightness(1.06) contrast(1.1) saturate(1.38) sepia(0.24) hue-rotate(-8deg)',
    description: 'Golden romantic sunset warmth that flatters all skin tones.'
  },
  bw: {
    id: 'bw',
    name: 'Classic B&W',
    tag: 'Vintage 1950s',
    css: 'grayscale(1) contrast(1.32) brightness(1.05)',
    description: 'Timeless high-contrast French photobooth monochrome.'
  },
  sepia: {
    id: 'sepia',
    name: 'Vintage Sepia',
    tag: 'Retro 1970s',
    css: 'sepia(0.72) contrast(1.15) brightness(0.95) saturate(1.1)',
    description: 'Nostalgic golden-brown tones reminiscent of old keepsake prints.'
  },
  pastel: {
    id: 'pastel',
    name: 'Soft Dreamy Pastel',
    tag: 'Ethereal Haze',
    css: 'brightness(1.12) contrast(0.92) saturate(1.25) hue-rotate(10deg)',
    description: 'Gentle romantic glow with softened contrast and pastel tones.'
  },
  disposable: {
    id: 'disposable',
    name: '90s Disposable Cam',
    tag: 'Film Grain',
    css: 'contrast(1.22) saturate(1.32) sepia(0.12) brightness(1.02)',
    description: 'Punchy flash shadows and saturated colors like a Kodak disposable.'
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Romance',
    tag: 'Moody Blue',
    css: 'brightness(0.92) contrast(1.3) saturate(1.25) hue-rotate(190deg)',
    description: 'Cool midnight tones with dreamy contrast for late night booths.'
  }
};

class FilterManager {
  constructor() {
    this.currentPreset = 'natural';
    this.brightness = 100; // Percentage 50 - 180
    this.warmth = 0;       // -30 to +30 hue-rotate / sepia shift
    this.syncWithPartner = true;

    // Remote partner settings (if individual filters are active)
    this.remotePreset = 'natural';
    this.remoteBrightness = 100;
    this.remoteWarmth = 0;

    this.onLocalFilterChanged = null;
  }

  setPreset(presetId) {
    if (BOOTH_FILTERS[presetId]) {
      this.currentPreset = presetId;
      this.applyFilters();
      if (this.onLocalFilterChanged) {
        this.onLocalFilterChanged(this.getFilterState());
      }
    }
  }

  setBrightness(val) {
    this.brightness = Math.min(180, Math.max(50, Number(val) || 100));
    this.applyFilters();
    if (this.onLocalFilterChanged) {
      this.onLocalFilterChanged(this.getFilterState());
    }
  }

  setWarmth(val) {
    this.warmth = Math.min(30, Math.max(-30, Number(val) || 0));
    this.applyFilters();
    if (this.onLocalFilterChanged) {
      this.onLocalFilterChanged(this.getFilterState());
    }
  }

  setSyncMode(sync) {
    this.syncWithPartner = !!sync;
  }

  getFilterState() {
    return {
      preset: this.currentPreset,
      brightness: this.brightness,
      warmth: this.warmth,
      syncMode: this.syncWithPartner
    };
  }

  /**
   * Compute full CSS filter string combining preset + user sliders
   */
  computeFilterString(presetId, brightnessPct, warmthVal) {
    const preset = BOOTH_FILTERS[presetId] || BOOTH_FILTERS.natural;
    const brightnessFactor = (brightnessPct / 100).toFixed(2);
    
    // Add extra warmth adjustments
    let warmthFilter = '';
    if (warmthVal > 0) {
      const sepiaVal = (warmthVal / 100).toFixed(2);
      warmthFilter = `sepia(${sepiaVal}) hue-rotate(-${warmthVal / 2}deg)`;
    } else if (warmthVal < 0) {
      warmthFilter = `hue-rotate(${Math.abs(warmthVal)}deg)`;
    }

    return `${preset.css} brightness(${brightnessFactor}) ${warmthFilter}`.trim();
  }

  /**
   * Apply live filter to video DOM elements
   */
  applyFilters() {
    const localVideo = document.getElementById('local-video');
    if (localVideo) {
      localVideo.style.filter = this.computeFilterString(
        this.currentPreset,
        this.brightness,
        this.warmth
      );
    }

    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
      // If synced, remote partner gets same aesthetic on local display, or their own
      const targetPreset = this.syncWithPartner ? this.currentPreset : this.remotePreset;
      const targetBrightness = this.syncWithPartner ? this.brightness : this.remoteBrightness;
      const targetWarmth = this.syncWithPartner ? this.warmth : this.remoteWarmth;

      remoteVideo.style.filter = this.computeFilterString(
        targetPreset,
        targetBrightness,
        targetWarmth
      );
    }
  }

  /**
   * Handle filter update incoming from partner over WebSocket
   */
  handleRemoteFilterUpdate(data) {
    this.remotePreset = data.filterPreset || 'natural';
    this.remoteBrightness = data.brightness ?? 100;
    this.remoteWarmth = data.warmth ?? 0;

    if (data.syncMode || this.syncWithPartner) {
      this.currentPreset = this.remotePreset;
      this.brightness = this.remoteBrightness;
      this.warmth = this.remoteWarmth;

      // Update UI sliders & chips to reflect partner's choice
      const slider = document.getElementById('brightness-slider');
      if (slider) slider.value = this.brightness;
      const warmthSlider = document.getElementById('warmth-slider');
      if (warmthSlider) warmthSlider.value = this.warmth;
      
      const chips = document.querySelectorAll('.filter-chip');
      chips.forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === this.currentPreset);
      });
    }

    this.applyFilters();
  }
}

// Global filter manager singleton
window.filterManager = new FilterManager();
