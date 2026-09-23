# Frame — Lesson Recorder v0.9.9

Direct WebM recording. No converter or MP4 step is needed for new recordings.

## Use

1. Stop any current recording and wait for its download before updating.
2. Reload the existing extension in chrome://extensions, then refresh the lesson page. Both recorder-test-extension and capture-test contain the same build.
3. Click the pinned Frame icon. The player expands inside the tab. Source quality must reach 1080p; select it manually if the site's quality API is unsupported. The lesson restarts from the beginning.
4. Pause, buffering, seeking, missing geometry and stale player state hold the MediaRecorder, including both audio and video. Playback resumes the same recording.
5. Click Frame again to stop, or let the lesson finish. Wait for DONE.
6. Open Downloads/FrameCaptureTests/<lesson title>.webm directly. Repeated recordings receive a suffix. No JSON file downloads; the latest diagnostic report is retained in extension-local storage.

Right-click Frame > Options for status and help. Preloading remains best effort through the existing player integration; it cannot force every server/player to buffer a complete lesson.

## Reliability

19 Node regression checks pass, including pause, buffering, seek and invalid geometry transitions, excluded hold-time accounting, preserving the first container chunk and both tracks, startup errors and download completion. Syntax checks pass. Tests use a mocked MediaRecorder; actual Chromium WebM timeline continuity, seekability, audio sync and background capture remain to be verified with a real sample. This is a release candidate, not a claim of gapless frame-perfect capture.

Player events and tab capture arrive asynchronously, so brief transition frames can remain. Source resolution is distinct from captured resolution: output is limited by source, visible player area and the 1920x1080 capture budget. Original controls and overlays inside the video can be captured. Sleep, site changes and unusual iframe layouts remain limitations.

Crash recovery is deferred. Recording stays in memory until stopped; closing/reloading Chrome, loss of power or a crash can lose the current recording. Keep the computer awake and the lesson tab open. No microphone is requested. Protected streams are not decrypted.

## Older recordings

Existing .raw.webm and JSON pairs are unchanged. The old Python converter and Start Converter.cmd remain only for legacy recordings; do not run them for the new direct WebM workflow. Older recordings are not retroactively trimmed by this update.

## v0.9.9 autoplay fix
Removed automatic mute/unmute and synthetic control clicks. If Chrome blocks autoplay, Frame waits with CLICK PLAYER PLAY. Click the original website player once; recording continues after playback is permitted. The extension preserves the player's mute setting. Both startup and post-rewind playback use this behavior. Automated rejection/recovery tests pass; live browser validation remains pending.
