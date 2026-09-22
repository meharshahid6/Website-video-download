# Universal Video Course Recorder (v0.8.0 - Natural Page Recording)

Chrome extension for one-click clean recording of lecture videos across any educational platform (iSkills, EzyCourse, Coursera, Udemy, YouTube, Vimeo, etc.) — records the tab exactly as you see it with zero page modifications.

## Key Highlights (v0.8.0)

- **Zero Page Modification**: The extension does NOT change the page layout. No fullscreen, no theater mode, no hiding elements. The page stays exactly as you see it — sidebar, tabs, header, controls, everything remains intact.
- **Player Controls Stay Visible**: Mouse hover shows video controls normally so you can always see video progress, timeline, and where the video has reached.
- **Lesson-Specific File Names**: Downloads are named after the specific lesson (e.g. `App_Niche_research_through_Flippa_2026-09-22.raw.webm`) instead of the overall course name.
- **Instant Auto-Play**: Dispatches real PointerEvents to trigger LMS play buttons (including the circular blue play button on iSkills/EzyCourse).
- **HUD Play Button**: If autoplay is blocked, a `[▶ Play]` button appears on the on-screen HUD for instant 1-click playback.
- **Full 1080p Tab Capture**: Records the entire browser tab at up to 1920x1080 resolution with VP9 encoding at 8Mbps.
- **Active Playback Recording**: Discards pre-playback frames. Recording starts when the video actually starts playing.
- **Advance Buffer Booster**: Forces players (HLS.js, Video.js, HTML5) to buffer up to 10–20 minutes ahead, protecting against internet disconnects.
- **Live Buffer HUD**: Real-time `⚡ 3m 45s buf` indicator with color-coded safety status.
- **Tab Audio Capture**: Audio captured directly from the tab without microphone access.
- **Auto-Stop on Video End**: Recording stops automatically when the lecture finishes.

## Quick Start

1. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
2. Click **Reload** on the unpacked `recorder-test-extension` (or **Load unpacked** and select the folder).
3. Navigate to any lecture video (e.g. `app.iskills.com`).
4. Click the extension icon:
   - Video auto-plays while page stays completely normal
   - Controls remain visible on hover
   - HUD shows recording status in top-left corner
5. When lecture finishes (or click Stop on HUD / extension icon):
   - File saves to `Downloads/FrameCaptureTests/` with the lesson name
6. Run `python capture-test/auto-finalize.py` to produce trimmed MP4s.
