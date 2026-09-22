# Universal Video Course Recorder — v0.9.2

Records the visible video rectangle and internal tab audio, keeping the surrounding course page out of the saved WebM. The player expands inside the tab during capture; the original page layout is restored on stop. Browser tabs and the Windows taskbar remain accessible.

## Changes

- Crops the tab stream to the detected video before encoding. The sidebar and header outside that rectangle are excluded from the downloaded `.raw.webm`, not only from the later MP4.
- Keeps original aspect ratio and caps output at native captured pixels / source pixels / 1920x1080. It does not claim 1080p when the visible player is smaller.
- Uses the visible heading directly above the player as the preferred filename. Falls back to lesson selectors, active lesson, headings, then page title. The title is read again at first playback and frozen for that recording, so an automatic next lesson cannot rename it.
- Preserves Unicode and spaces; removes invalid Windows filename characters. Repeated recordings use a shared suffix for the WebM and timing report.
- Keeps the first WebM chunk, starts the recorder at first playback, and records pause/buffering intervals for the MP4 finalizer.
- Moves the recorder HUD outside the video rectangle, or hides it if no space remains (the extension toolbar icon still stops recording).
- The finalizer now discovers lesson-named recordings as well as older `test-*` files.

## Use

1. Reload the unpacked extension in `chrome://extensions`. Either existing folder (`recorder-test-extension` or `capture-test`) contains the same v0.9.2 build.
2. Open a lesson and keep the entire player visible in its own tab. Select the desired playback quality.
3. Click the recorder extension icon. It attempts autoplay; use the site's Play control if needed.
4. The recording stops at the end, or via the extension icon / HUD Stop button.
5. Downloads appear under `Downloads/FrameCaptureTests/<Lesson title>.raw.webm` and the matching `.json` timing report.
6. Run `python capture-test/auto-finalize.py` with PyAV and NumPy installed (or the existing bundled Python environment). Final trimmed MP4s appear in `final-recordings/<Lesson title>.mp4`.

The WebM is already cropped but still includes pauses; the finalizer applies the same marked cuts to audio and video. JSON is supporting timing data, not the video.

## Limits and verification

Automated regression tests cover crop bounds and scaling, invalid geometry, Unicode filenames, changing lesson headings, canvas/video track selection, preserving the first chunk, audio routing, and startup errors. Run:

`node --test capture-test/test-startup.cjs capture-test/test-crop-title.cjs`

Live v0.9.2 Chrome recording has not yet been verified: the browser connection returned a request-header policy error. A real foreground/background sample, speaker-mute test, and visual/audio check remain required. Do not treat mocked tests as proof of capture performance.

The visible player determines actual captured resolution. Enlarge the player within its tab for higher resolution. Scrolling it partly out of view, stale telemetry, or ambiguous iframe geometry produces a hold/black frame instead of recording the whole page. Arbitrarily nested iframes and unusual CSS transforms are not guaranteed. Site overlays that cover the video itself can appear in the crop. Capture does not decrypt or bypass protected media.

For long lectures, the next improvement should be incremental disk storage: this version accumulates WebM chunks in memory. Pause trimming and automatic lesson-to-lesson segmentation remain separate from filename/crop changes.

### v0.9.2 startup fix

Removed the inline buffer-booster fallback; the existing chrome.scripting MAIN-world call remains. Capture dimensions now follow the starting page viewport aspect ratio instead of forcing a 16:9 tab capture. This fixes the reported 1536x703 page / 1920x1080 capture mismatch that prevented recording from starting. A no-video result now shows ERR, with the crop diagnostic in JSON. Reload the extension and refresh the course page to remove the previous injected monitor. Live Chrome confirmation is still pending.

### In-tab player expansion
The player expands before capture starts, without requesting browser or OS fullscreen. The title is read before expansion. Latest inspected pre-expansion sample: 1350x628, 331 decoded frames, timestamps 0.869–21.055 seconds. New live resolution and background smoothness remain unverified; available viewport and source aspect ratio limit resolution. Reload extension and refresh course page for v0.9.2.


### v0.9.4 original hover controls
Removed the custom progress strip and forced native controls. Theater mode selects the nearest bounded player wrapper containing the site controls and expands inner video wrappers. The site retains its own hover, buffering, quality and playback controls. Reload extension and refresh the course page to remove the previous custom bar. Live hover behavior still needs verification on the site.

### v0.9.5 startup quality
Latest inspected recording was 516x238. Fixed canvas size being allocated on low-resolution startup frames before source quality settled. Recording now waits for source height >=1080 and stable dimensions for 1.5 seconds; lower-quality sources stay on hold. Exposed HLS and compatible player APIs get a best-effort 1080p preference. Unsupported players require manual quality selection. This is a source-quality check, not a guarantee of 1080 output pixels: tab capture/crop remains limited by viewport and its 1920x1080 capture budget. The startup wait omits that initial playback interval; start before the desired lesson section. Live-site verification of this update remains pending.


## v0.9.6 — recording checks
- Source and output dimensions plus internal audio activity are shown in the HUD where there is room outside the crop, and in the extension icon tooltip. Quiet audio is not proof of failure; it can be intentional silence. Audio analysis is never routed to speakers or microphone.
- A LOW badge warns when source height drops below 1080 during capture. Recording continues so lecture content is not silently discarded.
- After the initial quality check, seekable lessons are paused and rewound to the beginning; recording is armed before playback resumes. Live/non-seekable lessons fail explicitly. Every new recording starts from the beginning.
- SAVE waits for both raw video and report download completion. DONE confirms those downloads only, not MP4 conversion. Interrupted downloads show ERR.
- The separate Python converter decodes the completed MP4 to verify both tracks before publishing it, and writes status verified-mp4 to its verification report. It must be running; extension-to-converter live status is not implemented.
- Crash recovery / periodic disk saving is deferred. Real-site verification of this release remains pending; automated tests exercise mocked capture and download states.
