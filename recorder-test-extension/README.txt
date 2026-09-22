UNIVERSAL VIDEO COURSE RECORDER v0.5.0 (ADVANCE BUFFER BOOSTER)

Ye extension ab tamam websites aur platforms par advance buffer booster ke sath kaam karti hai:
- iSkills (app.iskills.com)
- Sarmaaya (learn.sarmaaya.pk)
- EzyCourse, Coursera, Udemy, YouTube, Vimeo, Wistia, BunnyCDN, etc.

CHALANE KA TAREEQA:
1. Chrome mein chrome://extensions kholein, Developer mode ON karein.
2. Extension ko RELOAD karein (ya Load unpacked se recorder-test-extension folder select karein).
3. Kisi bhi website par video/lesson kholein (jaise app.iskills.com ya learn.sarmaaya.pk).
4. Extension icon ek baar click karein:
   - Video AUTOMATICALLY play ho jayega (iSkills ka center blue play button bhi auto-click hoga)
   - Advance Buffer Booster player ko force karega ke 10-20 minute aage tak video pehle se load kar le
   - Left sidebar (curriculum list), header, bottom buttons sab hide ho jayenge
   - Video clean screen par expand ho jayega
   - Player controls recording ke dauran hide ho jayenge
   - Recording shuru ho jayegi
5. Screen par top-left mein HUD dikhega:
   - 🔴 REC = recording chal rahi hai
   - 🟡 HOLD = player paused/buffering/seeking
   - Timer = recording ka actual time (pauses excluded)
   - ⚡ [time] buf = kitne seconds/minutes video advance mein pehle se load/buffer ho chuki hai!
   - ■ Stop button = recording band karne ke liye
6. Recording band karne ke tareeqey:
   - Extension icon dobara click karein
   - Ya HUD par ■ Stop button dabayein
   - Ya video khatam hone par khud stop ho jayega
7. Downloads/FrameCaptureTests mein file automatically website aur lesson ke naam ke sath save hogi:
   Jaise: Iskills_SEBT_NEXT_2026-09-22T....raw.webm aur .json
8. python capture-test/auto-finalize.py chalayein — final MP4 final-recordings mein aa jayegi!

KEY FEATURES (v0.5.0):
- Advance Buffer Booster: HLS.js, Video.js, Bitmovin aur HTML5 video ko 10-20 mins advance buffer par force karta hai.
- Live Buffer HUD: Screen par live dikhta hai ke kitna buffer aage load ho chuka hai (Green = safe from disconnects).
- Global Support: Har website (<all_urls>) par chalta hai.
- Universal Auto-Play: Direct play + center-point click (iSkills circular button) + selector query.
- Universal Clean View: Sidebars, headers aur unnecessary elements hide kar deta hai.
- Universal Player Controls Hiding: EzyCourse, Bunny, Plyr, Video.js, native controls sab hide.
- Smart File Naming: Site aur lecture name ke sath download save hota hai.
- No Time Limit: Poori lecture record hogi.
