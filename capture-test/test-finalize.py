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
    folder=Path.home()/'Downloads'/'FrameCaptureTests'
    broken=folder/'test-2026-09-21T18-29-52-880Z.raw.webm'
    try:finalize(broken,broken.with_name(broken.name.replace('.raw.webm','.json')),temp/'broken.mp4')
    except ValueError as e:assert 'insufficient' in str(e)
    else:raise AssertionError('Broken nine-frame recording was accepted')
print('PASS: exact crop dimensions; low resolution rejected; broken live capture rejected.')
