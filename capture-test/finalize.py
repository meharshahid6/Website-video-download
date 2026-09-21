"""Local test finalizer: remove the same marked intervals from audio and video."""
import sys,json,math
from pathlib import Path
from fractions import Fraction
sys.path.insert(0,str(Path(__file__).parent/'verification-tools'))
import av,numpy as np

def _finalize(source,report_path,destination):
    report=json.loads(report_path.read_text())
    if report.get('strategy')!='continuous-capture-then-trim':raise ValueError('Requires continuous-capture timing report')
    with av.open(str(source)) as check:
        video_times=[float(f.time or 0) for f in check.decode(video=0)]
    with av.open(str(source)) as check:
        audio_times=[float(f.time or 0)+f.samples/f.sample_rate for f in check.decode(audio=0)]
    if len(video_times)<10 or not audio_times:raise ValueError('Capture failed: insufficient video/audio frames; a new capture is required.')
    if abs(video_times[-1]-audio_times[-1])>1.5:raise ValueError('Capture failed: audio/video coverage differs by more than 1.5 seconds.')
    if abs(report['captureSeconds']-audio_times[-1])>2:raise ValueError('Capture clock does not match its report; refusing unreliable cuts.')
    if any(e.get('status')=='player-state-unavailable' for e in report['events']):raise ValueError('Player telemetry was lost. Unknown intervals cannot safely be removed.')
    crop_records=report.get('geometry',[]) if report.get('cropAfterCapture') else []
    if report.get('cropAfterCapture') and not crop_records:raise ValueError('Video crop geometry missing.')
    def crop_at(t,width,height):
        available=[g for g in crop_records if g['captureMs']/1000<=t]
        if not available:raise ValueError('No crop geometry for this interval.')
        g=available[-1];r=g['rect'];view=g['viewport']
        if abs((width/height)/(view['width']/view['height'])-1)>0.02:raise ValueError('Captured viewport aspect ratio changed; crop requires verification.')
        sx=width/view['width'];sy=height/view['height']
        x=max(0,math.ceil(r['x']*sx));y=max(0,math.ceil(r['y']*sy))
        w=int(min(r['width']*sx,width-x))//2*2;h=int(min(r['height']*sy,height-y))//2*2
        if h<=720 or g['sourceHeight']<=720:raise ValueError('Actual video crop is not above 720p.')
        return x,y,w,h
    events=[e for e in report['events'] if e.get('captureMs') is not None]
    intervals=[]
    for i,event in enumerate(events):
        if event.get('state',event.get('status'))!='recording':continue
        begin=max(0,event['captureMs']/1000)
        end=events[i+1]['captureMs']/1000 if i+1<len(events) else report['captureSeconds']
        if end>begin:intervals.append((begin,end))
    if not intervals:raise ValueError('No usable playing interval')
    chunks=[];audio_end=0;rate=48000
    with av.open(str(source)) as container:
        resampler=av.AudioResampler(format='fltp',layout='stereo',rate=rate)
        for decoded in container.decode(audio=0):
            for frame in resampler.resample(decoded):
                start=max(0,round(float(frame.time or 0)*rate));a=frame.to_ndarray();chunks.append((start,a));audio_end=max(audio_end,start+a.shape[1])
        for frame in resampler.resample(None):
            start=max(0,round(float(frame.time or 0)*rate));a=frame.to_ndarray();chunks.append((start,a));audio_end=max(audio_end,start+a.shape[1])
    intervals=[(a,min(b,audio_end/rate)) for a,b in intervals if a<audio_end/rate]
    timeline=np.zeros((2,audio_end),dtype=np.float32)
    for start,a in chunks:timeline[:,start:start+a.shape[1]]=a
    kept=np.concatenate([timeline[:,round(a*rate):round(b*rate)] for a,b in intervals],axis=1)
    duration=kept.shape[1]/rate
    def source_time(t):
        for a,b in intervals:
            if t<b-a:return a+t
            t-=b-a
        return intervals[-1][1]-1/rate
    with av.open(str(source)) as inp, av.open(str(destination),'w',options={'movflags':'+faststart'}) as out:
        vs=inp.streams.video[0]
        size=(vs.codec_context.width,vs.codec_context.height)
        if crop_records:size=crop_at(intervals[0][0],*size)[2:]
        vout=out.add_stream('libx264',rate=30);vout.width=size[0];vout.height=size[1];vout.pix_fmt='yuv420p';vout.options={'crf':'18','preset':'veryfast'}
        aout=out.add_stream('aac',rate=rate);aout.layout='stereo';aout.bit_rate=128000
        frames=iter(inp.decode(video=0));current=next(frames);upcoming=next(frames,None)
        for index in range(math.ceil(duration*30)):
            target=source_time(index/30)
            while upcoming is not None and float(upcoming.time or 0)<=target:
                current=upcoming;upcoming=next(frames,None)
            if crop_records:
                x,y,w,h=crop_at(target,current.width,current.height)
                if w<size[0] or h<size[1]:raise ValueError('Video shrank during capture; refusing upscaled output.')
                pixels=current.to_ndarray(format='rgb24')[y:y+h,x:x+w]
                result=av.VideoFrame.from_ndarray(np.ascontiguousarray(pixels),format='rgb24').reformat(width=size[0],height=size[1],format='yuv420p')
            else:result=current.reformat(format='yuv420p')
            result.pts=index;result.time_base=Fraction(1,30)
            for packet in vout.encode(result):out.mux(packet)
        for packet in vout.encode():out.mux(packet)
        for pos in range(0,kept.shape[1],1024):
            frame=av.AudioFrame.from_ndarray(np.ascontiguousarray(kept[:,pos:pos+1024]),format='fltp',layout='stereo');frame.sample_rate=rate;frame.time_base=Fraction(1,rate);frame.pts=pos
            for packet in aout.encode(frame):out.mux(packet)
        for packet in aout.encode():out.mux(packet)
    summary={'source':str(source),'output':str(destination),'keptIntervals':intervals,'keptSeconds':duration,'removedSeconds':report['captureSeconds']-duration,'note':'Same source-time cuts applied to both tracks; subjective lip-sync and live background capture still require checks.'}
    destination.with_suffix('.verification.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))

def finalize(source,report_path,destination):
    source,report_path,destination=map(Path,(source,report_path,destination))
    pending=destination.with_name(destination.stem+'.pending.mp4')
    pending_report=pending.with_suffix('.verification.json')
    try:
        _finalize(source,report_path,pending)
        verified=json.loads(pending_report.read_text());verified['output']=str(destination)
        pending.replace(destination)
        destination.with_suffix('.verification.json').write_text(json.dumps(verified,indent=2))
    finally:
        pending.unlink(missing_ok=True)
        pending_report.unlink(missing_ok=True)

if __name__=='__main__':
    if len(sys.argv)==4:finalize(*map(Path,sys.argv[1:]))
    else:
        for name in ['pause','buffering']:
            root=Path(__file__).parent;finalize(root/f'lab-{name}.webm',root/f'lab-{name}.json',root/f'lab-{name}-final.mp4')
