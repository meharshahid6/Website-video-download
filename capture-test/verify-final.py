import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'verification-tools'))
import av,numpy as np
from PIL import Image,ImageDraw
root=Path(__file__).parent
results=[];sheet=Image.new('RGB',(1280,600),'#222');draw=ImageDraw.Draw(sheet)
for row,name in enumerate(['pause','buffering']):
    p=root/f'lab-{name}-final.mp4'
    times=[];size=None;images=[]
    for f in av.open(str(p)).decode(video=0):
        times.append(float(f.time));size=[f.width,f.height]
        if len(images)<2 and f.time >= (1 if not images else 4):
            im=f.to_image();im.thumbnail((640,270));images.append(im)
    audio=[];rms=[]
    for f in av.open(str(p)).decode(audio=0):
        audio.append(float(f.time)+f.samples/f.sample_rate);rms.append(float(np.sqrt(np.mean(f.to_ndarray().astype(float)**2))))
    result={'test':name,'resolution':size,'videoFrames':len(times),'videoDuration':times[-1]+1/30,'audioDuration':audio[-1],'endDifferenceSeconds':abs(times[-1]+1/30-audio[-1]),'maxFrameGap':float(max(np.diff(times))),'meanAudioRMS':float(np.mean(rms))}
    assert result['endDifferenceSeconds']<0.06
    assert result['maxFrameGap']<0.034
    assert result['meanAudioRMS']>0.001
    results.append(result)
    for col,im in enumerate(images):sheet.paste(im,(col*640,row*300+25));draw.text((col*640+5,row*300+5),name+' final',fill='white')
sheet.save(root/'lab-final-frames.jpg')
(root/'lab-final-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
