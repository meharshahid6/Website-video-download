# Website-video-download

Chrome extension and local processing pipeline for recording and extracting lecture videos with telemetry-based trimming.

## Overview
- **Extension**: Manifest V3 Chrome extension using native tab capture and player DOM monitoring.
- **Isolation**: Pure internal tab audio without microphone access; compatible with Windows speaker mute.
- **Post-Processing**: Python finalizer (`finalize.py`) cuts out paused/buffering periods identically from audio and video to maintain perfect lip-sync.
