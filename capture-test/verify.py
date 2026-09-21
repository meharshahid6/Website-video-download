import sys, json, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'verification-tools'))
import av
import numpy as np
from PIL import Image, ImageDraw

root=Path(__file__).parent
source=sorted(root.glob('test-*.webm'))[-1]
report={'file':source.name,'bytes':source.stat().st_size}
with av.open(str(source)) as container:
    report['streams']=[{'type':s.type,'codec':s.codec_context.name} for s in container.streams]
    video=container.streams.video[0]
    report['resolution']=[video.codec_context.width,video.codec_context.height]
    times=[]; images=[]; next_sample=0
    for frame in container.decode(video):
        t=float(frame.time or 0);times.append(t)
        if t>=next_sample and len(images)<6:
            im=frame.to_image(); im.thumbnail((640,360)); images.append((t,im));next_sample+=5
    report['video_frames']=len(times)
    report['video_first_last_seconds']=[times[0],times[-1]] if times else []
    sheet=Image.new('RGB',(1280,3*390),'#202020');draw=ImageDraw.Draw(sheet)
    for i,(t,im) in enumerate(images):
        x=(i%2)*640;y=(i//2)*390
        sheet.paste(im,(x,y+25));draw.text((x+8,y+5),f'{t:.2f} seconds',fill='white')
    sheet.save(root/'verification-frames.jpg')
with av.open(str(source)) as container:
    count=0; energy=0.;peak=0.; first=None;last=None;decoded=0
    for frame in container.decode(audio=0):
        a=frame.to_ndarray().astype(np.float64)
        if frame.format.name.startswith('s16'):a/=32768
        elif frame.format.name.startswith('s32'):a/=2147483648
        count+=a.size;energy+=float(np.sum(a*a));peak=max(peak,float(np.max(np.abs(a))))
        t=float(frame.time or 0)
        if first is None:first=t
        last=t+frame.samples/frame.sample_rate;decoded+=1
    report['audio']={'decoded_frames':decoded,'first_seconds':first,'last_seconds':last,'rms':math.sqrt(energy/count) if count else 0,'peak':peak}
(root/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
