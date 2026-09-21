SARMAAYA VIDEO RECORDER v0.3.0

1. Chrome mein chrome://extensions kholein, Developer mode ON karein.
2. Load unpacked se yeh recorder-test-extension folder select karein.
3. Course video tab par jayein (learn.sarmaaya.pk).
4. Extension icon ek baar click karein:
   - Video AUTOMATICALLY play hoga
   - Page clean fullscreen ho jayega (sirf video dikhega)
   - Player controls hide ho jayengey
   - Recording shuru ho jayegi
5. Screen par top-left mein HUD dikhega:
   - 🔴 REC = recording chal rahi hai
   - 🟡 HOLD = player paused/buffering/seeking
   - Timer = recording ka actual time (pauses excluded)
   - ■ Stop button = jaldi band karne ke liye
6. Extension icon dobara click karne se ya HUD Stop button se recording band hogi.
7. Video khatam hone par recording khud band ho jayegi.
8. Downloads/FrameCaptureTests mein RAW WebM aur JSON timing report save hoti hain.
9. python capture-test/auto-finalize.py chalayein — clean MP4 final-recordings mein aa jayegi.

WHAT THIS DOES
- Chrome ka ordinary tab capture use karta hai. No DRM decryption.
- Microphone KABHI request nahi hota. Tab audio speakers par nahi jaata.
- Page ke sarey extra elements (header, sidebar, navigation) hide ho jaate hain.
- Player ke controls (play/pause bar, progress bar) bhi hide ho jaate hain.
- Video player ko fullscreen karke native resolution par capture karta hai.
- Continuous recording — pause/buffering intervals baad mein finalizer nikal deta hai.
- VP9 at 8Mbps — sharp text aur slides ke liye.
- Koi time limit NAHI. Puri lecture record hogi.

RECORDING BAND KARNE KE TAREEQEY
- Extension icon dobara click karein
- HUD par ■ Stop button click karein
- Course tab band karein (auto-stop)
- Video khatam ho jaye (auto-stop)

LIMITS
- Chrome aur tab khula rakhein.
- Computer awake rakhein (sleep mode mein recording ruk jayegi).
- Sirf apna content record karein.
- Player controls hide hone ke baad agar aapko video control karna hai,
  to extension icon se stop karein ya HUD Stop button use karein.
