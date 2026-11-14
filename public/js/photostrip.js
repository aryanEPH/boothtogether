/**
 * BoothTogether - Photobooth Strip Engine
 * Precision center-crop canvas rendering, multi-shot sequencing,
 * customizable retro borders, and high-res JPG & PDF export.
 */

const STRIP_THEMES = {
  cream: {
    id: 'cream',
    name: 'Classic Cream',
    bg: '#FFFDF7',
    border: '#E8E2D2',
    text: '#222222',
    subtext: '#666666',
    accent: '#E05A47',
    sprocket: '#444444'
  },
  noir: {
    id: 'noir',
    name: 'Noir Charcoal',
    bg: '#18181B',
    border: '#27272A',
    text: '#F4F4F5',
    subtext: '#A1A1AA',
    accent: '#F43F5E',
    sprocket: '#52525B'
  },
  blush: {
    id: 'blush',
    name: 'Rose Blush',
    bg: '#FFF1F2',
    border: '#FFE4E6',
    text: '#881337',
    subtext: '#9F1239',
    accent: '#E11D48',
    sprocket: '#FDA4AF'
  },
  kraft: {
    id: 'kraft',
    name: 'Retro Kraft',
    bg: '#EBDCB9',
    border: '#D8C69D',
    text: '#3E2723',
    subtext: '#5D4037',
    accent: '#D84315',
    sprocket: '#8D6E63'
  },
  lavender: {
    id: 'lavender',
    name: 'Lavender Haze',
    bg: '#F5F3FF',
    border: '#EDE9FE',
    text: '#4C1D95',
    subtext: '#6D28D9',
    accent: '#7C3AED',
    sprocket: '#C4B5FD'
  }
};

class PhotoStripEngine {
  constructor() {
    this.capturedShots = []; // Array of shot objects with captured frames
    this.currentTheme = 'cream';
    this.customCaption = 'Together in Booth 💕';
    this.locationTag = 'Across the Miles';
    this.includeBarcode = true;
    this.includeSprockets = true;
    this.activeStickers = ['heart', 'sparkle']; // 'heart', 'sparkle', 'kiss', 'plane'

    this.renderCanvas = document.createElement('canvas');
    this.renderCtx = this.renderCanvas.getContext('2d');
  }

  reset() {
    this.capturedShots = [];
  }

  /**
   * Capture a single frame from both videos simultaneously at flash moment
   */
  captureCurrentFrame(localVideo, remoteVideo, filterManager) {
    const shotData = {
      timestamp: Date.now(),
      localSnapshot: null,
      remoteSnapshot: null,
      localFilter: filterManager ? filterManager.computeFilterString(
        filterManager.currentPreset,
        filterManager.brightness,
        filterManager.warmth
      ) : 'none',
      remoteFilter: filterManager ? filterManager.computeFilterString(
        filterManager.syncWithPartner ? filterManager.currentPreset : filterManager.remotePreset,
        filterManager.syncWithPartner ? filterManager.brightness : filterManager.remoteBrightness,
        filterManager.syncWithPartner ? filterManager.warmth : filterManager.remoteWarmth
      ) : 'none'
    };

    // Grab offscreen bitmap or canvas from local video
    if (localVideo && localVideo.readyState >= 2) {
      shotData.localSnapshot = this.cloneVideoToCanvas(localVideo, shotData.localFilter, true);
    }

    // Grab offscreen bitmap or canvas from remote video
    if (remoteVideo && remoteVideo.readyState >= 2) {
      shotData.remoteSnapshot = this.cloneVideoToCanvas(remoteVideo, shotData.remoteFilter, false);
    } else {
      // If remote partner is not yet in booth (solo test mode), create a placeholder or mirrored twin!
      shotData.remoteSnapshot = this.createPartnerPlaceholder(localVideo, shotData.localFilter);
    }

    this.capturedShots.push(shotData);
    return shotData;
  }

  /**
   * Snapshot a video feed onto an offscreen canvas with filter baked in
   */
  cloneVideoToCanvas(video, filterStr, isMirrored = false) {
    const offCanvas = document.createElement('canvas');
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    offCanvas.width = vw;
    offCanvas.height = vh;
    const ctx = offCanvas.getContext('2d');

    // Apply active filter to the 2D context
    if (ctx.filter !== undefined && filterStr && filterStr !== 'none') {
      ctx.filter = filterStr;
    }

    ctx.save();
    if (isMirrored) {
      ctx.translate(vw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, vw, vh);
    ctx.restore();

    return offCanvas;
  }

  /**
   * If testing solo, create cute mirrored partner preview or cozy silhouette
   */
  createPartnerPlaceholder(localVideo, filterStr) {
    const offCanvas = document.createElement('canvas');
    const vw = localVideo ? (localVideo.videoWidth || 640) : 640;
    const vh = localVideo ? (localVideo.videoHeight || 480) : 480;
    offCanvas.width = vw;
    offCanvas.height = vh;
    const ctx = offCanvas.getContext('2d');

    if (localVideo && localVideo.readyState >= 2) {
      // Mirror local user as partner companion for solo testing
      if (ctx.filter !== undefined && filterStr && filterStr !== 'none') {
        ctx.filter = filterStr;
      }
      ctx.drawImage(localVideo, 0, 0, vw, vh);
      // Add subtle "Partner Slot (Solo Preview)" badge
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(0, vh - 60, vw, 60);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 22px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Partner Spot 💕', vw / 2, vh - 24);
    } else {
      // Cute waiting silhouette
      ctx.fillStyle = '#222226';
      ctx.fillRect(0, 0, vw, vh);
      ctx.fillStyle = '#E05A47';
      ctx.font = '64px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('💌', vw / 2, vh / 2 - 20);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 24px Outfit, sans-serif';
      ctx.fillText('Waiting for your partner...', vw / 2, vh / 2 + 50);
    }

    return offCanvas;
  }

  /**
   * Center-crop an image/canvas onto a destination rectangle (object-fit: cover)
   */
  drawCenterCrop(ctx, source, dx, dy, dw, dh) {
    if (!source) return;
    const sw = source.width || 640;
    const sh = source.height || 480;
    const targetAspect = dw / dh;
    const sourceAspect = sw / sh;

    let sx, sy, cropW, cropH;
    if (sourceAspect > targetAspect) {
      // Source is wider than target
      cropH = sh;
      cropW = sh * targetAspect;
      sx = (sw - cropW) / 2;
      sy = 0;
    } else {
      // Source is taller than target
      cropW = sw;
      cropH = sw / targetAspect;
      sx = 0;
      sy = (sh - cropH) / 2;
    }

    ctx.drawImage(source, sx, sy, cropW, cropH, dx, dy, dw, dh);
  }

  /**
   * Render the complete photobooth composite strip onto high-res canvas
   */
  renderStrip(options = {}) {
    const themeKey = options.theme || this.currentTheme;
    const theme = STRIP_THEMES[themeKey] || STRIP_THEMES.cream;
    const shots = this.capturedShots;
    const shotCount = shots.length || 1;
    const roomId = options.roomId || 'BOOTH';
    const caption = options.caption !== undefined ? options.caption : this.customCaption;
    const locationTag = options.locationTag !== undefined ? options.locationTag : this.locationTag;

    // High resolution rendering for 300 DPI print quality
    const stripWidth = 900; // Strip width in pixels
    const padX = 54;        // Horizontal padding
    const innerWidth = stripWidth - (padX * 2);

    // Each frame height based on 4:3 individual ratio side-by-side
    // Two partners side-by-side: each photo is innerWidth / 2 wide
    const slotGap = 16;
    const photoWidth = (innerWidth - slotGap) / 2;
    const photoHeight = Math.round(photoWidth * (4 / 3)); // 4:3 portrait ratio for each partner!
    const frameHeight = photoHeight + 24; // with surrounding border
    const frameGap = 32;

    const headerHeight = 160;
    const footerHeight = 220;

    const totalHeight = headerHeight + (frameHeight * shotCount) + (frameGap * (shotCount - 1)) + footerHeight;

    this.renderCanvas.width = stripWidth;
    this.renderCanvas.height = totalHeight;
    const ctx = this.renderCtx;

    // 1. Draw Strip Background
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, stripWidth, totalHeight);

    // 2. Film Sprocket Holes along the edges (classic analog film look)
    if (this.includeSprockets) {
      this.drawSprocketHoles(ctx, stripWidth, totalHeight, theme.sprocket);
    }

    // 3. Header: Vintage Marquee & Romance Title
    this.drawHeader(ctx, stripWidth, headerHeight, theme, roomId);

    // 4. Render Each Shot Slot
    let currentY = headerHeight;
    for (let i = 0; i < shotCount; i++) {
      const shot = shots[i];
      this.drawShotFrame(ctx, shot, padX, currentY, innerWidth, frameHeight, photoWidth, photoHeight, slotGap, theme, i + 1);
      currentY += frameHeight + frameGap;
    }

    // 5. Footer: Date, Customizable Romantic Caption & Vintage Barcode
    this.drawFooter(ctx, stripWidth, currentY, footerHeight, theme, caption, locationTag, roomId);

    // 6. Optional Stickers & Doodles
    this.drawStickers(ctx, stripWidth, totalHeight, theme);

    return this.renderCanvas;
  }

  /**
   * Draw film perforations along the left and right border
   */
  drawSprocketHoles(ctx, width, height, color) {
    const holeW = 12;
    const holeH = 20;
    const step = 44;
    ctx.fillStyle = color;

    for (let y = 30; y < height - 30; y += step) {
      // Left sprocket
      this.drawRoundedRect(ctx, 16, y, holeW, holeH, 3, true);
      // Right sprocket
      this.drawRoundedRect(ctx, width - 28, y, holeW, holeH, 3, true);
    }
  }

  /**
   * Draw Strip Header
   */
  drawHeader(ctx, width, height, theme, roomId) {
    ctx.save();
    ctx.textAlign = 'center';

    // Stars / Sparkles
    ctx.fillStyle = theme.accent;
    ctx.font = 'bold 22px serif';
    ctx.fillText('★   ★   ★', width / 2, 52);

    // Marquee Title
    ctx.fillStyle = theme.text;
    ctx.font = '900 36px "Playfair Display", "Cinzel", "DM Serif Display", serif';
    ctx.letterSpacing = '6px';
    ctx.fillText('BOOTH TOGETHER', width / 2, 98);

    // Romantic Subtitle / Room tag
    ctx.fillStyle = theme.subtext;
    ctx.font = '500 16px Outfit, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText(`VIRTUAL PHOTOBOOTH • #${roomId}`, width / 2, 130);

    // Thin accent divider line
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(80, 146);
    ctx.lineTo(width - 80, 146);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Draw a single shot frame containing both partners side-by-side
   */
  drawShotFrame(ctx, shot, x, y, width, height, photoWidth, photoHeight, gap, theme, index) {
    ctx.save();

    // Frame Card Background & Border
    ctx.fillStyle = theme.bg === '#18181B' ? '#222226' : '#FFFFFF';
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    this.drawRoundedRect(ctx, x, y, width, height, 12, true, true);

    const photoY = y + (height - photoHeight) / 2;
    const leftPhotoX = x + (width - (photoWidth * 2 + gap)) / 2;
    const rightPhotoX = leftPhotoX + photoWidth + gap;

    // Draw Left Partner Photo (Local user - mirrored horizontally for natural mirror feel)
    if (shot && shot.localSnapshot) {
      ctx.save();
      // Clip rounded photo
      this.drawRoundedRect(ctx, leftPhotoX, photoY, photoWidth, photoHeight, 8, false, false);
      ctx.clip();
      this.drawCenterCrop(ctx, shot.localSnapshot, leftPhotoX, photoY, photoWidth, photoHeight);
      ctx.restore();
    }

    // Draw Right Partner Photo (Remote partner - clean unmirrored)
    if (shot && shot.remoteSnapshot) {
      ctx.save();
      this.drawRoundedRect(ctx, rightPhotoX, photoY, photoWidth, photoHeight, 8, false, false);
      ctx.clip();
      this.drawCenterCrop(ctx, shot.remoteSnapshot, rightPhotoX, photoY, photoWidth, photoHeight);
      ctx.restore();
    }

    // Border around individual photos
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    this.drawRoundedRect(ctx, leftPhotoX, photoY, photoWidth, photoHeight, 8, false, true);
    this.drawRoundedRect(ctx, rightPhotoX, photoY, photoWidth, photoHeight, 8, false, true);

    // Small shot number badge in center bottom
    ctx.fillStyle = theme.accent;
    ctx.font = 'bold 13px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`♥ POSE ${index} ♥`, x + width / 2, y + height - 6);

    ctx.restore();
  }

  /**
   * Draw Strip Footer
   */
  drawFooter(ctx, width, startY, height, theme, caption, locationTag, roomId) {
    ctx.save();
    ctx.textAlign = 'center';

    const midY = startY + 36;

    // Romantic Caption
    ctx.fillStyle = theme.text;
    ctx.font = 'bold 26px "Playfair Display", serif';
    ctx.fillText(caption || 'Together Forever 💕', width / 2, midY);

    // Location / Distance Tag
    ctx.fillStyle = theme.accent;
    ctx.font = '600 16px Outfit, sans-serif';
    ctx.fillText(`✈️  ${locationTag || 'Miles Apart, Hearts Together'}`, width / 2, midY + 32);

    // Formatted Date
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }).toUpperCase();
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });

    ctx.fillStyle = theme.subtext;
    ctx.font = '500 14px monospace';
    ctx.letterSpacing = '2px';
    ctx.fillText(`${dateStr} • ${timeStr}`, width / 2, midY + 62);

    // Vintage Barcode & Love Stamp
    this.drawVintageBarcode(ctx, (width - 240) / 2, midY + 84, 240, 36, theme.text);

    // Footer copyright / serial code
    ctx.fillStyle = theme.subtext;
    ctx.font = '11px monospace';
    ctx.fillText(`NO. ${roomId}-${Date.now().toString().slice(-6)} • BOOTH-TOGETHER.APP`, width / 2, midY + 140);

    ctx.restore();
  }

  /**
   * Draw decorative vintage barcode
   */
  drawVintageBarcode(ctx, x, y, w, h, color) {
    ctx.save();
    ctx.fillStyle = color;
    let currX = x;
    const barWidths = [2, 4, 1, 3, 2, 5, 1, 4, 2, 3, 1, 5, 2, 4, 3, 1, 4, 2, 5, 3, 2, 1, 4, 3, 2, 5, 1, 4, 2, 3];
    
    for (let i = 0; i < barWidths.length && currX < x + w - 10; i++) {
      const bw = barWidths[i];
      if (i % 2 === 0) {
        ctx.fillRect(currX, y, bw, h);
      }
      currX += bw + 2;
    }
    ctx.restore();
  }

  /**
   * Draw optional cute stickers / doodles
   */
  drawStickers(ctx, width, height, theme) {
    if (!this.activeStickers || this.activeStickers.length === 0) return;

    ctx.save();
    ctx.font = '28px serif';
    ctx.textAlign = 'center';

    if (this.activeStickers.includes('heart')) {
      ctx.fillText('💖', 60, height - 70);
      ctx.fillText('💖', width - 60, height - 70);
    }
    if (this.activeStickers.includes('sparkle')) {
      ctx.fillText('✨', 80, 80);
      ctx.fillText('✨', width - 80, 80);
    }
    if (this.activeStickers.includes('kiss')) {
      ctx.fillText('💋', width - 75, 175);
    }
    ctx.restore();
  }

  /**
   * Helper: Draw rounded rectangle
   */
  drawRoundedRect(ctx, x, y, width, height, radius, fill = true, stroke = false) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  /**
   * Download strip as high-resolution JPEG
   */
  downloadJpg(roomId = 'BOOTH') {
    const filename = `BoothTogether-${roomId}-${new Date().toISOString().slice(0, 10)}.jpg`;
    const link = document.createElement('a');
    link.download = filename;
    link.href = this.renderCanvas.toDataURL('image/jpeg', 0.95);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Download strip as print-ready PDF
   */
  async downloadPdf(roomId = 'BOOTH') {
    const filename = `BoothTogether-${roomId}-${new Date().toISOString().slice(0, 10)}.pdf`;

    // 1. If window.jspdf is available from CDN, use it
    if (window.jspdf && window.jspdf.jsPDF) {
      const { jsPDF } = window.jspdf;
      // Photobooth strip format: 2 x 6 inches (50.8 x 152.4 mm) or proportional
      const widthMm = 65;
      const heightMm = (this.renderCanvas.height / this.renderCanvas.width) * widthMm;

      const pdf = new jsPDF({
        orientation: heightMm > widthMm ? 'portrait' : 'landscape',
        unit: 'mm',
        format: [widthMm, heightMm]
      });

      const imgData = this.renderCanvas.toDataURL('image/jpeg', 0.96);
      pdf.addImage(imgData, 'JPEG', 0, 0, widthMm, heightMm);
      pdf.save(filename);
      return;
    }

    // 2. Otherwise use zero-dependency fallback PDF generator
    if (window.createPhotostripPdfFallback) {
      const pdfBlob = await window.createPhotostripPdfFallback(this.renderCanvas);
      const blobUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      return;
    }

    // Fallback: download JPG if PDF generation is somehow blocked
    this.downloadJpg(roomId);
  }

  /**
   * Copy image to user's clipboard for instant pasting
   */
  async copyToClipboard() {
    if (!navigator.clipboard || !window.ClipboardItem) {
      throw new Error('Clipboard image copy not supported in this browser.');
    }
    return new Promise((resolve, reject) => {
      this.renderCanvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('Canvas to blob failed.'));
          return;
        }
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          resolve(true);
        } catch (err) {
          reject(err);
        }
      }, 'image/png');
    });
  }
}

// Global photostrip engine singleton
window.photostripEngine = new PhotoStripEngine();
