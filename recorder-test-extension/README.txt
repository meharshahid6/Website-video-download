# Frame — Lesson Recorder v1.0.0

Direct WebM recording with injected duration metadata, keyboard hotkeys, enhanced speech audio, and a draggable HUD. No converter or MP4 step is needed for new recordings.

## Use

1. Stop any current recording and wait for its download before updating.
2. Reload the existing extension in chrome://extensions, then refresh the lesson page. Both recorder-test-extension and capture-test contain the same build.
3. Click the pinned Frame icon or press **Alt+Shift+R**. The player expands inside the tab. Source quality must reach 1080p; select it manually if the site's quality API is unsupported. The lesson restarts from the beginning.
4. Pause, buffering, seeking, missing geometry and stale player state hold the MediaRecorder, including both audio and video. Playback resumes the same recording.
5. Click Frame again (or press **Alt+Shift+R**) to stop, or let the lesson finish. Wait for DONE.
6. Open Downloads/FrameCaptureTests/<lesson title>.webm directly. Repeated recordings receive a suffix. Output files have valid EBML duration metadata for full timeline seekability across all desktop media players.

Right-click Frame > Options for status and help. Preloading remains best effort through the existing player integration; it cannot force every server/player to buffer a complete lesson.

## Reliability

20 Node regression checks pass, including duration injection, pause, buffering, seek and invalid geometry transitions, excluded hold-time accounting, preserving the first container chunk and both tracks, startup errors and download completion. Syntax checks pass.

## New in v1.0.0

1. **WebM Duration Fix:** Automatically patches EBML Segment Info metadata with accurate duration upon download. Videos show exact runtimes in Windows Explorer, VLC, and media players with instant scrub/seek.
2. **Keyboard Shortcut:** `Alt + Shift + R` toggles start and stop anywhere on the page without reaching for the toolbar.
3. **Speech Booster & Normalizer:** Audio is routed through Web Audio dynamics compression and a gentle gain boost, ensuring quiet instructors are recorded loud, clear, and without distortion.
4. **Draggable & Minimizable HUD:** Drag the overlay anywhere on the screen so it never covers lecture slides or captions, or click `—` to collapse it into a minimal pill.

