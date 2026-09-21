# Recorder test status

## Latest update — 0.2.0

The first actual extension recording was found and decoded: only nine video frames
ending at 3.126 seconds, versus audio ending at 63.536 seconds and a 184.527-second
capture report. It is not usable and must not be converted into a purported complete video.

The recording path has been replaced by direct native tab capture, capped at
1920x1080, with no live canvas loop. Video geometry is saved for post-capture cropping.
The timer worker now waits for acknowledgement and cannot queue unlimited ticks.
This targets the observed frame starvation; it has not yet been verified on a new live capture.

Local finalization now checks actual media coverage, clock consistency, telemetry,
crop geometry and resolution before delivery. Exact crop-size and rejection tests pass.
Failed processing cannot leave a final-named MP4. An automatic local finalizer is
watching Downloads/FrameCaptureTests and writes valid outputs to final-recordings.

Files for version 0.2.0 are staged in BOTH recorder-test-extension and capture-test.
Chrome must reload the installed extension before the new capture path takes effect.
Browser automation still cannot connect. Live testing of the new version remains outstanding.

The live course has not yet been tested with the new extension. Do not describe all requirements as passed.

## Confirmed

- Original 30-second browser-tab capture saved 5,299,443 bytes, with visible lecture frames and a non-silent Opus audio track. No microphone was requested.
- The course player reports a 1920x1080 source. Player quality was set to 1080p and playback speed to Normal (1x) for testing.
- The previous 1920x808 recording included the whole page. The actual embedded lecture image was below 720 pixels high. Whole-file dimensions were not proof of lecture quality.
- Nine geometry/player-state assertions ran in Chrome.
- A local replay test detected a roughly 2-second manual pause.
- A local server deliberately interrupted delivery of the saved test video. The browser emitted waiting/playing events and the recorder logged about 4.4 seconds of real buffering.
- Direct MediaRecorder pause/resume showed inconsistent audio/video timing in a test. That approach was replaced with continuous capture and identical source-time cuts for both tracks.
- Finalized local pause test: 2.039 seconds excluded; finalized buffering test: 4.515 seconds excluded (includes initial capture delay).
- Both final lab files decode as 1920x808 video at 30 fps with non-silent audio. Audio/video endpoint difference was 0.012 seconds. This is not a subjective lip-sync test or proof of live frame delivery rate.
- Cropping/state logic and extension JavaScript syntax checked. User reports extension loaded and active; live operation has not been independently observed.
- Startup handling now saves a readable diagnostic report, handles offscreen rejection, and recovers stale sessions. Four mocked startup tests pass. This is not a live Chrome validation.
- Current browser connection fails before listing any tabs, including after a session reset. No files are currently present in the expected Downloads/FrameCaptureTests location.

## Required live tests

1. Load the unpacked test extension into the Chrome profile that contains the course tab.
2. Test Windows speaker mute while the player's own volume stays above zero.
3. Capture with source tab hidden, with another window/profile active, and verify audio and changing source frames throughout.
4. Inspect video-only crop and actual native output height above 720 pixels; do not count upscaling as higher quality.
5. Pause/resume the actual player and seek into an unbuffered section; inspect logged intervals and finalized output.
6. Check lip sync at start, around each cut and at the end; assess frame drops and text legibility.
7. Check stop/source close behavior and file save; subsequently do a longer test before a production tool.

## Test extension behavior

Source location: ../recorder-test-extension. Matching extension files are also staged in capture-test, the folder selected by the user. The latest startup fixes require an extension reload before they take effect.
Clicking the extension icon on the course starts a bounded 120-second test and enlarges the player inside its tab. A second click stops early. It saves raw video and a JSON timing report under Downloads/FrameCaptureTests. It does not request microphone access, decrypt media, change capture protection or transmit recordings externally.

The local finalizer removes paused/buffering/seeking/below-quality intervals from both tracks and creates the final MP4. Temporary raw recordings can contain those intervals. Transition accuracy depends on the timing of player events, so zero unwanted frames is not guaranteed yet.

Windows speaker controls, the extension install dialog and toolbar icon are not exposed to the available browser automation surface. User interaction is needed for installation, starting the test and the actual Windows mute toggle. Browser security settings will not be changed programmatically.
