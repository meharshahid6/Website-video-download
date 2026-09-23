@echo off
cd /d "%~dp0"
set "FRAME_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%FRAME_PYTHON%" (
  echo Python runtime not found. Install Python with PyAV and NumPy, then run capture-test\auto-finalize.py.
  pause
  exit /b 1
)
echo Frame - MP4 converter
echo Keep this window open while recordings are being finalized.
"%FRAME_PYTHON%" "capture-test\auto-finalize.py"
pause
