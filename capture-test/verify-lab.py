import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'verification-tools'))
import av,numpy as np
root=Path(__file__).parent
results=[]
for p in root.glob('lab-*.webm'):
    video=[float(f.time) for f in av.open(str(p)).decode(video=0)]
    audio=[(float(f.time)+f.samples/f.sample_rate,float(np.sqrt(np.mean(f.to_ndarray().astype(float)**2)))) for f in av.open(str(p)).decode(audio=0)]
    row={'file':p.name,'videoFrames':len(video),'videoEnd':video[-1],'audioEnd':audio[-1][0],'maxVideoGap':float(max(np.diff(video))),'audioRMSMean':float(np.mean([a[1] for a in audio]))}
    results.append(row)
print(json.dumps(results,indent=2))
(root/'lab-decode-results.json').write_text(json.dumps(results,indent=2))
