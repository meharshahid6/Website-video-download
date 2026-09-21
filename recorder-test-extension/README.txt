VIDEO FRAME RECORDER 0.2.0 — LIVE VALIDATION STILL REQUIRED

1. Chrome mein chrome://extensions kholein, Developer mode ON karein.
2. Load unpacked se yeh recorder-test-extension folder select karein.
3. Course video ki speed 1x rakhein. Extension ko pin karein.
4. Course tab par extension icon ek baar click karein: 120-second bounded test shuru.
5. REC = recording, HOLD = player paused/buffering/seeking, low resolution, or speed not 1x.
6. Extension icon dobara click karne se test jaldi stop hoga.
7. Downloads/FrameCaptureTests mein RAW WebM aur JSON timing report save hoti hain.
   Yeh raw test recording final file nahi. Local finalizer audio/video dono se
   pause aur buffering intervals ek saath nikal kar final MP4 banata hai.

WHAT THIS TEST DOES
- Uses Chrome's ordinary tab capture. No DRM decryption or protection changes.
- Microphone is never requested. Tab audio is not sent to speakers.
- Enlarges the embedded player within its tab and restores its original layout on stop.
- Captures native tab audio/video directly, without a live canvas rendering loop.
- Saves geometry for the local finalizer to crop the visible video image.
- Finalizer rejects actual video crops 720px high or less, missing video, lost
  telemetry, mismatched capture clocks, and unreliable viewport geometry.
- Limits output to original source resolution and 1920x1080; no artificial enlargement.
- Marks play/pause/waiting/seeking/ended intervals for local finalization.
- Uses a continuous clock; MediaRecorder pause/resume caused timing drift in lab tests.
- Does not treat a static slide or silent moment as a pause.
- Records for at most 120 wall-clock seconds, regardless of pauses.

LIVE CHECKS STILL REQUIRED
After updating files, reload the installed extension so version 0.2.0 takes effect.
Actual Windows speaker mute, hidden source tab, another window/profile, pause/resume,
real buffering, crop stability, A/V sync, frame drops and output resolution.
Lab results alone do not establish that this extension passes these checks on Sarmaaya.

LIMITS
Test build only. No multi-lesson queue. Short buffering/control overlays can precede
the player's state event. Do not promise zero transition frames without measuring.
Keep source tab/Chrome open and computer awake. Record only content you may record.
If Chrome crashes, this short test's in-memory recording can be lost.
