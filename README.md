# Universal Video Course Recorder (v0.5.0 - Advance Buffer Booster)

Chrome extension and local processing pipeline for one-click clean recording and extraction of lecture videos across any educational platform (iSkills, Sarmaaya, EzyCourse, Coursera, Udemy, YouTube, Vimeo, Wistia, etc.) with advance buffer boosting and telemetry-based trimming.

## Features (v0.5.0)

- **Advance Buffer Booster (Anti-Disconnect Preloader)**: Injects main-world scripts and video preloading directives to force players (HLS.js, Video.js/VHS, Bitmovin, HTML5) to buffer up to 10-20 minutes of video in advance. Keeps playing smoothly even if the internet drops temporarily!
- **Live Buffer HUD Indicator**: On-screen HUD displays real-time advance buffer (`⚡ 3m 45s buf`) with color-coded safety indicators (green = healthy buffer > 60s, sky blue = good, yellow = buffering).
- **Universal / Global Support**: Works on any website (`<all_urls>`). Tested on `app.iskills.com` and `learn.sarmaaya.pk`.
- **One-Click Auto-Play**: Automatically plays the video upon extension click:
  - Direct HTML5 `video.play()`
  - Center-point element detection (`document.elementFromPoint(cx, cy)`) to click custom player play buttons (e.g. iSkills circular blue play button)
  - Broad selector support for LMS players, Plyr, Video.js, BunnyCDN/Bitmovin, and custom overlays
- **Universal Clean View**: Automatically isolates the video element or player iframe to 100vw x 100vh (`z-index: 2147483645`), cleanly hiding curriculum sidebars, headers, bottom action bars, and page scrollbars.
- **Player Controls Hiding**: Hides playback bars, scrubbers, volume sliders, and play button overlays during active recording for pristine captures. Controls restore automatically when stopped.
- **On-Page HUD**: Non-intrusive live status overlay (`REC`, `HOLD`, recording timer, advance buffer indicator, and stop button `■`) in the top-left corner.
- **Smart Named Downloads**: Automatically names downloads using the platform name and lesson title (e.g. `Downloads/FrameCaptureTests/Iskills_SEBT_NEXT_2026-09-22T01-15-00.raw.webm`).
- **Full Lecture Support**: No arbitrary time limit. Auto-stops when the video finishes, or when manually stopped via the icon or HUD.
- **Internal Tab Audio**: Tab audio captured directly without microphone access or speaker interference. Works even when Windows speakers are muted.
- **Smart Pause Trimming**: Telemetry tracks buffering, seeking, pauses, and non-1x rates, enabling post-capture synchronized trimming with zero lip-sync drift.
- **High Quality**: VP9 preferred at 8Mbps for sharp presentation text and slides.

## Quick Start

1. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
2. Click **Load unpacked** and select the `recorder-test-extension` folder (or click **Reload** if already installed).
3. Navigate to any lecture video (e.g., `app.iskills.com` or `learn.sarmaaya.pk`).
4. Click the extension icon in your Chrome toolbar:
   - Video will auto-play
   - Sidebars and chrome hide immediately
   - Recording starts with the on-screen HUD
5. When the lecture ends (or when you click the HUD stop button / extension icon):
   - `.raw.webm` and `.json` telemetry files are saved to `Downloads/FrameCaptureTests/`
   - Page view and player controls restore to normal
6. Run `python capture-test/auto-finalize.py` to produce trimmed MP4s in `final-recordings/`.

## Extension Architecture

- `manifest.json`: Manifest V3 configuration with `<all_urls>` host permissions and necessary tabCapture/offscreen APIs.
- `background.js`: Orchestrates tab capture stream, isolates video/iframe into clean fullscreen, handles message routing, and sequences downloads.
- `monitor.js`: Injected into all frames. Detects the video, fires multi-strategy auto-play, tracks playback telemetry, and injects clean-view control-hiding styles.
- `hud.js`: On-page glassmorphism HUD displaying live state and stop controls.
- `offscreen.js`: MediaRecorder engine running in an offscreen document with VP9/VP8 encoding and worker heartbeat.
- `auto-finalize.py` & `finalize.py`: Python post-processor using PyAV to crop and trim paused intervals into final MP4 files.
