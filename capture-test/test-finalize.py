import json,tempfile
from pathlib import Path
from finalize import finalize,av
root=Path(__file__).parent
with tempfile.TemporaryDirectory(dir=root) as temp:
    temp=Path(temp)
    original=json.loads((root/'lab-pause.json').read_text())
    original.update(cropAfterCapture=True,geometry=[{'captureMs':0,'rect':{'x':100,'y':20,'width':1720,'height':768},'viewport':{'width':1920,'height':808},'sourceWidth':1920,'sourceHeight':1080}])
    report=temp/'crop.json';report.write_text(json.dumps(original))
    output=temp/'crop.mp4';finalize(root/'lab-pause.webm',report,output)
    with av.open(str(output)) as c:
        assert (c.streams.video[0].width,c.streams.video[0].height)==(1720,768)
    original['geometry'][0]['rect']['height']=700;report.write_text(json.dumps(original))
    try:finalize(root/'lab-pause.webm',report,temp/'low-quality.mp4')
    except ValueError as e:assert '720p' in str(e)
    else:raise AssertionError('Low-quality crop was accepted')
    # Self-contained broken-capture fixture; do not depend on user Downloads.
    import numpy as np
    from fractions import Fraction
    broken=temp/'nine-frames.mp4'
    with av.open(str(broken),'w') as out:
        stream=out.add_stream('libx264',rate=30);stream.width=64;stream.height=64;stream.pix_fmt='yuv420p'
        audio=out.add_stream('aac',rate=48000);audio.layout='stereo'
        for i in range(9):
            frame=av.VideoFrame.from_ndarray(np.zeros((64,64,3),dtype=np.uint8),format='rgb24')
            frame.pts=i;frame.time_base=Fraction(1,30)
            for packet in stream.encode(frame):out.mux(packet)
        for packet in stream.encode():out.mux(packet)
        frame=av.AudioFrame.from_ndarray(np.zeros((2,4800),dtype=np.float32),format='fltp',layout='stereo')
        frame.sample_rate=48000;frame.pts=0;frame.time_base=Fraction(1,48000)
        for packet in audio.encode(frame):out.mux(packet)
        for packet in audio.encode():out.mux(packet)
    try:finalize(broken,report,temp/'broken.mp4')
    except ValueError as e:assert 'insufficient' in str(e)
    else:raise AssertionError('Broken nine-frame recording was accepted')
print('PASS: exact crop dimensions; low resolution rejected; broken capture rejected.')
