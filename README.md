# Universal Video Course Recorder (v0.7.0 - Dynamic Tab Theater & Pointer Auto-Play)

Chrome extension and local processing pipeline for one-click clean recording and extraction of lecture videos across any educational platform (iSkills, Sarmaaya, EzyCourse, Coursera, Udemy, YouTube, Vimeo, Wistia, etc.) with clean in-tab theater isolation, intact browser window, and robust auto-play.

## Key Highlights in v0.7.0

- **Intact Chrome Window (Taskbar & Tabs Stay Visible)**: Completely eliminates OS F11 fullscreen. Chrome stays in your normal maximized window—your Windows taskbar, start menu, and Chrome browser tabs remain 100% visible and accessible throughout recording.
- **Dynamic In-Tab Theater Mode**: The webpage layout is never deformed or broken. When the video starts playing, the video element smoothly expands to fill the browser tab viewport (100vw x 100vh) over a clean black background with hidden player controls, ensuring clean 1080p recording without page clutter.
- **Zero Confusion ("Video Kaha Pe Hai")**: If the video is paused or loading, the page remains completely natural and visible. The video is smoothly scrolled to the center of your screen.
- **HUD Interactive Play Button**: If a platform blocks autoplay, a prominent `[▶ Play]` button appears directly on the on-screen HUD. One click gives authentic user activation and starts playback immediately.
- **React 18 / LMS PointerEvent Auto-Play**: Dispatches real `PointerEvent` (`pointerover`, `pointerdown`, `pointerup`, `click`) with realistic coordinates and `buttons: 1`, ensuring custom React LMS play buttons (like the circular blue play button on `app.iskills.com`) trigger instantly.
- **Active Playback Recording**: Paused pre-playback chunks are discarded. The recording timer and file capture begin only when active video playback starts.
- **Advance Buffer Booster**: Injects main-world scripts to force players (HLS.js, Video.js, HTML5) to buffer up to 10–20 minutes of video in advance, protecting against internet disconnects.
- **Live Buffer HUD Indicator**: Real-time display on HUD (`⚡ 3m 45s buf`) with color-coded safety indicators.
- **Smart Named Downloads**: Automatically names downloads using the platform name and lesson title.
- **Internal Tab Audio**: Audio captured directly from the tab without microphone feedback or speaker volume dependency.

## Quick Start

1. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
2. Click **Reload** on the unpacked `recorder-test-extension` (or click **Load unpacked** and select the folder).
3. Navigate to any lecture video (e.g., `app.iskills.com` or `learn.sarmaaya.pk`).
4. Click the extension icon in your Chrome toolbar:
   - Video will smoothly scroll into view and auto-play
   - When playing, it cleanly fills the tab for recording
   - Taskbar and tabs remain fully visible
5. When the lecture finishes (or when you click the HUD stop button / extension icon):
   - `.raw.webm` is saved to `Downloads/FrameCaptureTests/`
   - Page view and player controls restore to normal
6. Run `python capture-test/auto-finalize.py` to produce trimmed MP4s in `final-recordings/`.
