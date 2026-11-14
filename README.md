# 💖 BoothTogether — Virtual Photobooth for Long-Distance (LDR) Couples

> *"Smile, pose, and stay intimate across any distance."*

**BoothTogether** is a full-stack, real-time web application built specifically for long-distance relationship (LDR) couples. Two partners can step into a private virtual photobooth using a 6-character room code, see each other live with low-latency WebRTC video, illuminate dark rooms with the built-in **Screen Flashlight (Beauty Ring Light)**, apply synchronized retro photobooth filters, trigger a simultaneous **3... 2... 1... countdown shutter**, and export a classic high-resolution photobooth strip as a **JPG** or **print-ready PDF**.

---

## ✨ Core Features & Technical Highlights

### 1. 🎟️ Private Room Pairing & 2-User Capacity Cap
- **Landing Screen**: Cozy, romantic retro marquee interface with two clear pathways:
  - **Create a Booth**: Generates a clean 6-character alphanumeric room code (e.g., `ROSE42`, `LOVE88`) with one-click invite link copying.
  - **Join a Booth**: Input field with uppercase formatting to join your partner's booth.
  - **Direct URL Joining**: Supports `?room=ABC123` or `#ABC123` so couples can join with a single click.
- **Strict 2-User Room Cap**: Enforced by the signaling server. If a third user tries to join, they receive a friendly notice and are redirected.
- **Graceful Camera Permissions**: Prompts for webcam and microphone with fallback test patterns if permissions are denied or when testing solo.

### 2. 💡 Screen Flashlight Mode (Beauty Ring Light)
- **Problem**: Long-distance couples often call late at night in bed with the lights off, making their webcam video dark and grainy.
- **Solution**: A prominent **Ring Light Toggle (`☀️ Ring Light`)** button.
  - When toggled ON, the entire surrounding webpage background switches to pure, high-contrast **`#FFFFFF` white**.
  - Generous white illumination padding expands around the video feeds, projecting high-intensity flattering light directly onto the users' faces.
  - UI buttons and icons remain crisply legible with high-contrast slate borders and subtle shadows.

### 3. 🎨 Live Filters & Exposure Balancing
- **Real-Time Brightness & Tone Sliders**: Adjust camera exposure from 50% to 180% to balance lighting between differing phone and laptop sensors.
- **Aesthetic Filter Presets**:
  - 🌿 **Natural**: Clean, true-to-life colors.
  - 🌅 **Warm Golden Hour**: Romantic sunset glow with golden skin tones.
  - 🎞️ **Classic B&W**: High-contrast, silvery 1950s French photobooth monochrome.
  - ☕ **Vintage Sepia**: 1970s nostalgic print tones.
  - 🌸 **Soft Dreamy Pastel**: Ethereal romantic haze with softened contrast.
  - 📷 **90s Disposable Cam**: Punchy flash shadows and retro saturation.
  - 🌌 **Midnight Noir**: Moody deep-indigo tones for late-night booths.
- **Filter Synchronization**: Toggle "Sync with partner" to match each other's aesthetic live over WebSockets.

### 4. ⏱️ Synchronized Shutter & Multi-Shot Captures
- **Synced Shutter Countdown**: Clicking the central vintage shutter button triggers a simultaneous **3... 2... 1... SMILE!** countdown across both devices with clock-drift compensation.
- **Audio Synthesis**: High-precision countdown beeps and mechanical shutter snap generated via the **Web Audio API** (100% reliable, zero external MP3 assets needed).
- **Multi-Shot Modes**:
  - **1 Snapshot**: Instant dual portrait.
  - **Classic 3-Shot Strip**: 3 consecutive poses with a 2-second prep pause between shots.
  - **Classic 4-Shot Strip**: 4 consecutive poses.
- **Flash Effect**: High-intensity full-screen white flash at moment zero, capturing exact pixel frames from both streams onto an off-screen HTML5 `<canvas>` with active brightness and filters baked into the pixels.

### 5. 🎞️ Photo Strip Customization & Export (JPG / PDF)
- **Stitched Composite Layout**:
  - Both partners side-by-side in each shot slot, framed in authentic vintage photobooth borders.
  - Sprocket holes / film perforations along the edges.
  - Stamped with the current date, time, room code, and customizable romantic caption (e.g., *"Aryan & Maya • 5,420 miles apart 💕"*).
- **Customizable Themes**:
  - Classic Cream (`#FFFDF7`)
  - Noir Charcoal (`#18181B`)
  - Rose Blush (`#FFE4E6`)
  - Retro Kraft (`#EBDCB9`)
  - Lavender Haze (`#EDE9FE`)
- **Export Options**:
  - 📥 **Download JPG**: High-resolution 300 DPI composite JPEG.
  - 📄 **Download PDF**: Print-ready 2x6" strip or postcard PDF (supports jsPDF CDN + zero-dependency pure JS PDF generator fallback).
  - 📋 **Copy to Clipboard**: Instant clipboard copy (`navigator.clipboard.write`) for pasting into iMessage, WhatsApp, Telegram, or Discord.
  - 🔄 **Retake**: Seamless return to live booth.

### 6. 📱 Cross-Device Compatibility (Laptop ↔ Mobile Phone)
- **Aspect Ratio Normalization**: Laptop webcams capture in 16:9 widescreen while phones capture in 9:16 or 4:3 portrait. BoothTogether enforces uniform **4:3 aspect ratio** using CSS `object-fit: cover` and matching mathematical center-crop on `<canvas>`:
  ```javascript
  // Center-crop formula ensures neither person looks stretched or squished
  if (videoAspect > targetAspect) {
    sHeight = vHeight;
    sWidth = vHeight * targetAspect;
    sx = (vWidth - sWidth) / 2;
  }
  ```
- **Mobile Video Attributes**: Local and remote `<video>` elements include `autoplay`, `playsinline`, `muted`, and `webkit-playsinline` so iOS Safari and Android Chrome never force fullscreen.
- **Camera Switcher**: Front ("user") and rear ("environment") camera flipping button.
- **NAT Traversal (STUN)**: Configured with public Google STUN servers (`stun:stun.l.google.com:19302`) so a mobile phone on 4G/5G cellular data can connect directly to a laptop on home Wi-Fi.

---

## 🚀 Quick Start & Setup Instructions

### Prerequisites
- Node.js installed (v18+ recommended; project has **zero npm dependencies**).

### 1. Run the Server
From the project folder, run:
```bash
# Option A: Windows 1-click script
start.bat

# Option B: Standard npm / node command
npm start
# or
node server.js
```

The server will launch:
```text
=======================================================
  ★ BoothTogether - Virtual LDR Photobooth Server ★   
  Local URL:        http://localhost:3000          
  WebSocket Server: ws://localhost:3000           
  Max Capacity:     Strictly 2 lovers per room        
=======================================================
```

---

## 🧪 Testing BoothTogether

### A. Testing on a Single Machine (Two Browser Windows)
1. Open `http://localhost:3000` in **Window 1** (e.g. Chrome).
2. Click **"Generate My Booth"** to get a 6-character room code (e.g. `ROSE42`).
3. Click **"Enter Booth Now"**.
4. Open an Incognito Window or a second browser (e.g. Edge / Firefox) in **Window 2**.
5. Paste `http://localhost:3000/?room=ROSE42` (or enter `ROSE42` in "Join Partner's Booth").
6. Both windows will connect instantly via WebRTC!
7. Try:
   - Toggling **☀️ Ring Light** mode.
   - Picking aesthetic filters (**Golden Hour**, **Classic B&W**, **Sepia**).
   - Clicking **SNAP** on either screen to watch the synchronized countdown and flash!
   - Customizing the resulting strip and downloading the **JPG** and **PDF**.

### B. Testing Across Devices (Laptop ↔ Phone over Wi-Fi / Cellular)

#### 🔒 Mobile Browser HTTPS Requirement
> **Important Note:** Modern mobile browsers (iOS Safari, Android Chrome) strictly require a **Secure Context (`https://` or `localhost`)** for `navigator.mediaDevices.getUserMedia` webcam access. Accessing an unencrypted `http://192.168.x.x:3000` IP from a phone will be blocked by the mobile browser.

To connect your phone to your computer, use any of these free tunnels:

#### Option 1: Free ngrok tunnel (Recommended)
```bash
# In a second terminal window:
npx ngrok http 3000
```
ngrok will provide a secure HTTPS link like `https://xxxx.ngrok-free.app`. Open that link on both laptop and phone!

#### Option 2: Localtunnel
```bash
npx localtunnel --port 3000
```
Open the generated HTTPS URL on your phone and laptop.

#### Option 3: Chrome Port Forwarding via USB
Connect your Android phone via USB, open `chrome://inspect/#devices` on your desktop Chrome, and set port `3000` to forward to `localhost:3000`. On your phone, open `http://localhost:3000`.

---

## 📁 Project Structure

```text
webpage/
├── server.js              # Zero-dependency Node.js HTTP & RFC 6455 WebSocket signaling server
├── package.json           # Project manifest
├── start.bat              # Windows 1-click startup batch script
├── node.cmd               # Node runtime delegation wrapper
├── README.md              # Project documentation
└── public/
    ├── index.html         # Landing screen, booth frame, flashlight mode & strip modal
    ├── css/
    │   ├── style.css      # Dark charcoal aesthetic, #FFFFFF ring light styles, responsive grid
    │   └── filters.css    # Color grading swatches & animations
    └── js/
        ├── app.js         # Core application coordinator & UI state machine
        ├── webrtc.js      # WebRTC connection, Google STUN servers, camera flip, test stream
        ├── signaling.js   # WebSocket signaling client (offers, answers, ICE, synced countdown)
        ├── filters.js     # Live filter presets (Golden Hour, B&W, Sepia, etc.) & brightness
        ├── photostrip.js  # Canvas rendering engine, center-crop math, high-res JPG & PDF export
        ├── audio.js       # Web Audio API synthesizer (shutter clicks, countdown beeps, chimes)
        └── lib/
            ├── jspdf-fallback.js    # Zero-dependency PDF 1.4 generator fallback
            └── confetti-fallback.js # Celebration confetti fallback
```

---

## 💌 Designed with Love
Built for long-distance couples who want to keep tangible, nostalgic memories of their time together.
