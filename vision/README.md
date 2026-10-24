# PillSense local hand-to-mouth observation

This Python 3.11 project preserves the teammate's OpenCV and MediaPipe detector
and makes its small observation events available to the authenticated PillSense
demo through a localhost-only bridge.

## Windows setup

From the repository root:

```powershell
py -3.11 -m venv vision\.venv
.\vision\.venv\Scripts\python.exe -m pip install -r vision\requirements.txt
```

Internet access is needed only to install packages. No model download or API
key is needed. Rebuild the virtual environment on each computer rather than
copying one.

## Run with the PillSense web app

Start the bridge from the repository root:

```powershell
.\vision\.venv\Scripts\python.exe -m vision.service
```

In a second terminal, run `npm run dev`, sign in, and open
`http://localhost:3000/demo`. Under **Today**, select **Start camera**. Stop the
camera from the same panel when finished. The service owns at most one camera
session and automatically releases it after five minutes, on Stop, on an error,
or when the process exits.

The bridge binds only to `127.0.0.1`. Camera-changing endpoints require a
short-lived, in-memory capability issued only to the explicit localhost browser
origin allowlist. `PILLSENSE_VISION_CAMERA` selects another camera and
`PILLSENSE_VISION_TIMEOUT_SECONDS` changes the timeout. To use a different
local web origin, update `PILLSENSE_VISION_ALLOWED_ORIGINS`; the browser URL is
configured with `NEXT_PUBLIC_VISION_BRIDGE_URL`. Do not expose the service via a
public tunnel.

Only small event records are sent to Convex: camera lifecycle, whether exactly
one person is visible, and a debounced hand-to-mouth observation. Raw frames,
face landmarks, embeddings, and video are never uploaded or stored. Convex
scopes events server-side to the authenticated user's authorized synthetic demo
patient. A gesture is not proof of medication ingestion and never changes a
dose, inventory, or dispenser state.

Run bridge tests without opening a real camera:

```powershell
.\vision\.venv\Scripts\python.exe -m pytest vision\tests
```

## Standalone debug preview

The original annotated preview remains available:

```powershell
.\vision\.venv\Scripts\python.exe vision\hand_mouth.py --camera 0
```

Allow camera permission if prompted. Retry with `--camera 1` or `--camera 2`
for an external webcam and close other camera apps if capture fails. Keep one
face visible and raise a hand. Green lines trace finger joints and the lip
outline. Fingertips near the lips for 0.15 seconds show **HAND AT MOUTH**. Press
**Q** to quit.

`detector.py` contains the shared landmark algorithm; `hand_mouth.py` is the
visual debug runner; `camera.py` provides lifecycle control and debouncing;
`service.py` is the localhost API. The detector observes 2D proximity only—not
physical mouth entry, swallowing, identity, or medication. Occlusion and depth
ambiguity can cause missed or false observations.
