# Website-video-download

Chrome extension and local processing pipeline for recording and extracting lecture videos from Sarmaaya with telemetry-based trimming.

## Features (v0.3.0)

- **One-click recording**: Extension icon click → video auto-plays, page goes clean fullscreen, recording starts.
- **Clean capture**: All page chrome (headers, sidebars, navigation) and player controls are hidden — only the video is captured.
- **Full lecture support**: No time limit. Recording auto-stops when video ends, or stop manually via icon/HUD.
- **On-page HUD**: Live recording status overlay showing REC/HOLD state, elapsed time, and a quick stop button.
- **Tab audio only**: Pure internal tab audio captured. No microphone. Works with Windows speakers muted.
- **Smart pause trimming**: Paused, buffering, seeking, and non-1x-speed intervals are cut from both audio and video simultaneously in post-processing — perfect lip sync.
- **Quality guard**: Output must exceed 720p. No artificial upscaling. VP9 at 8Mbps for sharp text.
- **Auto-finalization**: Local Python finalizer watches Downloads and produces clean MP4s automatically.

## How to Use

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** → select the `recorder-test-extension` folder.
3. Navigate to your course video on `learn.sarmaaya.pk`.
4. Click the extension icon — video auto-plays, fullscreen, recording starts.
5. Click icon again (or HUD stop button) to stop.
6. Raw files save to `Downloads/FrameCaptureTests/`.
7. Run `python capture-test/auto-finalize.py` to produce clean trimmed MP4s in `final-recordings/`.

## Architecture

- **Extension** (Manifest V3): `background.js` orchestrates, `offscreen.js` records via `MediaRecorder`, `monitor.js` tracks player state, `hud.js` shows on-page status.
- **Finalizer** (Python + PyAV): `finalize.py` reads timing reports, cuts unwanted intervals from both tracks, crops to native video dimensions, outputs H.264/AAC MP4.
