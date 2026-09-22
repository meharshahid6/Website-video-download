"""Finalize completed local recorder downloads without manual conversion commands."""
import json,time,traceback
from pathlib import Path
from finalize import finalize
root=Path(__file__).parent
incoming=Path.home()/'Downloads'/'FrameCaptureTests'
outgoing=root.parent/'final-recordings';outgoing.mkdir(exist_ok=True)
seen={}
print('Watching completed recording downloads. Final MP4s: '+str(outgoing),flush=True)
while True:
    for report in incoming.glob('*.json'):
        source=report.with_name(report.stem+'.raw.webm')
        if not source.exists():continue
        fingerprint=(source.stat().st_size,source.stat().st_mtime_ns,report.stat().st_mtime_ns)
        if seen.get(str(source))==fingerprint:continue
        if time.time()-max(source.stat().st_mtime,report.stat().st_mtime)<5:continue
        seen[str(source)]=fingerprint
        destination=outgoing/(report.stem+'.mp4')
        if destination.exists():continue
        try:
            finalize(source,report,destination)
            print('READY: '+str(destination),flush=True)
        except Exception as error:
            failure={'source':str(source),'error':str(error),'status':'capture-needs-attention'}
            (outgoing/(report.stem+'.error.json')).write_text(json.dumps(failure,indent=2))
            print('NEEDS ATTENTION: '+str(error),flush=True)
    time.sleep(3)
