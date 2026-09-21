import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'verification-tools'))
import av,numpy as np
from PIL import Image,ImageDraw
root=Path(__file__).parent
folder=Path.home()/'Downloads'/'FrameCaptureTests'
source=max(folder.glob('*.raw.webm'),key=lambda p:p.stat().st_mtime)
result={'file':str(source),'bytes':source.stat().st_size}
frames=[];times=[];next_sample=0
with av.open(str(source)) as c:
    result['streams']=[{'type':s.type,'codec':s.codec_context.name} for s in c.streams]
    for f in c.decode(video=0):
        t=float(f.time or 0);times.append(t)
        if t>=next_sample and len(frames)<6:
            im=f.to_image();im.thumbnail((640,360));frames.append((t,im));next_sample=t+10
    result['video']={'frames':len(times),'first':times[0] if times else None,'last':times[-1] if times else None,'maxGap':float(max(np.diff(times))) if len(times)>1 else None,'resolution':[f.width,f.height] if times else None}
audio_times=[];energy=0;count=0;peak=0
with av.open(str(source)) as c:
    for f in c.decode(audio=0):
        a=f.to_ndarray().astype(float);energy+=float(np.sum(a*a));count+=a.size;peak=max(peak,float(np.max(np.abs(a))));audio_times.append(float(f.time or 0)+f.samples/f.sample_rate)
result['audio']={'frames':len(audio_times),'end':audio_times[-1] if audio_times else None,'rms':float(np.sqrt(energy/count)) if count else 0,'peak':peak}
sheet=Image.new('RGB',(1280,3*390),'#222');draw=ImageDraw.Draw(sheet)
for i,(t,im) in enumerate(frames):
    x=(i%2)*640;y=(i//2)*390;sheet.paste(im,(x,y+25));draw.text((x+8,y+5),f'{t:.2f} sec',fill='white')
sheet.save(root/'live-test-frames.jpg');(root/'live-test-inspection.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
