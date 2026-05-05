# PassportEngine v1.0.0 — Deployment Guide

## Deployment Folder Structure

```
C:\Program Files\PassportEngine\
    PassportEngine.exe
    VERSION.txt
    nssm.exe
    service_install.bat
    service_uninstall.bat
    logs\
        passport_engine.log
        service.log
        error.log
```

---

## Step-by-Step Installation

### 1. Create install directory

```
mkdir "C:\Program Files\PassportEngine"
```

### 2. Copy files

Copy the following into `C:\Program Files\PassportEngine\`:

- `PassportEngine.exe` (from `dist\` after PyInstaller build)
- `VERSION.txt`
- `nssm.exe` (download 64-bit from https://nssm.cc/download)
- `service_install.bat`
- `service_uninstall.bat`

### 3. Install the Windows Service

Right-click `service_install.bat` → **Run as Administrator**

This will:
- Register PassportEngine as a Windows service
- Set it to start automatically on boot
- Set `PASSPORT_ENGINE_MODE=service` for minimal logging
- Configure auto-restart on crash (5s delay)
- Create `logs\` directory
- Start the service immediately

### 4. Verify installation

Open a browser and visit:

```
http://127.0.0.1:4765/status
```

Expected response:
```json
{"status": "running", "version": "1.0.0"}
```

Also check health:
```
http://127.0.0.1:4765/health
```

Expected response:
```json
{
  "engine": "PassportEngine",
  "version": "1.0.0",
  "status": "healthy",
  "uptime_seconds": 12.34,
  "memory_usage_mb": 57.0
}
```

### 5. Restart PC and verify auto-start

After reboot, the service should start automatically.
Verify by visiting `http://127.0.0.1:4765/status` again.

### 6. Check Windows Services

Open `services.msc` and look for **Passport Photo Processing Engine**.
Status should show **Running**, Startup Type should show **Automatic**.

---

## Uninstall

Right-click `service_uninstall.bat` → **Run as Administrator**

Then delete the folder:
```
rmdir /s /q "C:\Program Files\PassportEngine"
```

---

## API Endpoints

| Method | Path             | Auth Required | Description              |
|--------|------------------|---------------|--------------------------|
| GET    | `/status`        | No            | Version check            |
| GET    | `/health`        | No            | Memory + uptime probe    |
| POST   | `/process-zip`   | X-ENGINE-KEY  | Process ZIP file upload  |
| POST   | `/process-folder`| X-ENGINE-KEY  | Process folder by path   |

### Authentication

POST endpoints require the `X-ENGINE-KEY` header:
```
X-ENGINE-KEY: passport-engine-local-key
```

Override the default key via environment variable:
```
set ENGINE_API_KEY=your-secret-key
```

---

## Logs

| File                    | Contains                        |
|-------------------------|---------------------------------|
| `passport_engine.log`   | Application logs (5MB rotating) |
| `service.log`           | NSSM stdout capture             |
| `error.log`             | NSSM stderr capture             |

---

## Security

- Binds only to `127.0.0.1` (localhost) — not accessible from network
- CORS restricted to `http://localhost` and configured panel domain
- Non-localhost requests rejected with 403
- POST requests require `X-ENGINE-KEY` header
- No console window visible
- No stack traces exposed in API responses

---

## Troubleshooting

| Problem                    | Solution                                         |
|----------------------------|--------------------------------------------------|
| Service won't start        | Check `logs\error.log` and `logs\service.log`    |
| Port 4765 already in use   | Stop existing process: `netstat -ano | findstr 4765` |
| Double-click shows nothing | Expected — `console=False` in build. Check `/status` |
| Service not auto-starting  | Verify in `services.msc` → Startup Type = Automatic |

---

## Build from Source

```powershell
# Install dependencies
pip install -r requirements.txt
pip install pyinstaller

# Build exe
pyinstaller passport_engine.spec --clean --noconfirm

# Output: dist\PassportEngine.exe
```
