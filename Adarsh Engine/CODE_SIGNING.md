# CODE SIGNING GUIDE — Adarsh Engine
## How to fix "Windows protected your PC" and "Unknown Publisher"

---

## WHY THE EXE GETS BLOCKED (Root Cause)

### Problem 1 — Windows SmartScreen "hard block" (no GUI appears)
When you double-click `AdarshEngineSetup.exe`, Windows SmartScreen checks:
1. Is the file digitally signed with a trusted code-signing cert? → **No (unsigned)**
2. Does the file have an established reputation (many downloads)? → **No (new file)**

**Result:** SmartScreen shows the blue "Windows protected your PC" screen.
- If the user clicks **"More info → Run anyway"**, the Inno Setup wizard opens normally.
- If Defender has *quarantined* the file (threat detected), **nothing shows at all** — the file is blocked silently.

### Problem 2 — Why no Inno Setup GUI appears (your current symptom)
The most common reason silent block with zero GUI = **Windows Defender quarantine**.

To check:
1. Open **Windows Security → Virus & threat protection → Protection history**
2. Look for a recently blocked item named `AdarshEngineSetup.exe`
3. If found → click **"Allow on device"**

To prevent:
- Add the `Output/` folder to Defender exclusions temporarily during development.
- Long-term: use a signed EXE (see options below).

### Problem 3 — "Unknown Publisher" in standard dialogs
Even when SmartScreen allows the EXE, unsigned executables show "Unknown Publisher"
in UAC prompts. `sign_self.ps1` fixes this for UAC dialogs — but NOT for SmartScreen.

---

## OPTION 1 — Self-Signed Certificate (Free, local only)

**What it fixes:** "Unknown Publisher" in UAC dialogs  
**What it does NOT fix:** Windows SmartScreen blue screen

```powershell
# Run as Administrator:
.\sign_self.ps1
```

The certificate is trusted only on the machine where you run the script.
To trust it on the target install machine, distribute `adarsh_engine_selfsign.cer`
and import it:

```powershell
# On target machine (as Administrator):
Import-Certificate -FilePath "adarsh_engine_selfsign.cer" `
    -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher"
Import-Certificate -FilePath "adarsh_engine_selfsign.cer" `
    -CertStoreLocation "Cert:\LocalMachine\Root"
```

---

## OPTION 2 — Commercial Code Signing Certificate (~$27–$85/yr)

**What it fixes:** "Unknown Publisher" everywhere  
**What it does NOT fix:** SmartScreen initially (needs ~500–1000 downloads to build reputation)

Recommended providers (cheapest first):

| Provider | Price/yr | Notes |
|---|---|---|
| Certum Open Source | ~$27 | Cheapest. Requires open-source project verification |
| SSL.com Basic | ~$75 | Standard OV cert. Good for commercial apps |
| Sectigo (Comodo) | ~$85 | Popular, widely trusted |
| DigiCert | ~$300 | Enterprise tier |

Steps:
1. Buy the cert — you'll receive a `.pfx` file + password
2. Uncomment `SignTool=signtool` in `installer.iss`
3. Configure the sign tool path in Inno Setup (Tools → Configure Sign Tools):
   ```
   Name: signtool
   Command: signtool.exe sign /f "$qcert.pfx$q" /p $qYOUR_PASSWORD$q /fd sha256 /tr http://timestamp.digicert.com /td sha256 $f
   ```
4. Set GitHub Actions secrets:
   - `SIGN_CERT_BASE64` — base64 of the .pfx (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`)
   - `SIGN_CERT_PASSWORD` — password

---

## OPTION 3 — EV (Extended Validation) Certificate (~$300+/yr) ⭐ RECOMMENDED

**What it fixes:** EVERYTHING. Instant SmartScreen trust on first run.

An EV cert gives **immediate** SmartScreen trust — no reputation building required.
Required for any serious commercial Windows software distribution.

Providers:
| Provider | Price/yr | Notes |
|---|---|---|
| Sectigo EV | ~$299 | Requires hardware USB token (YubiKey or SafeNet) |
| DigiCert EV | ~$499 | Most trusted, fastest issuance |
| SSL.com EV | ~$239 | Good value |

**Requirement:** You will receive a physical USB token (YubiKey 5 or SafeNet iKey).
The private key never leaves the hardware token — this is a Windows requirement for EV.

---

## OPTION 4 — Microsoft Store Distribution (Free after one-time $19 fee)

Publishing via the Microsoft Store automatically bypasses SmartScreen entirely.
Not ideal for background services but worth considering if you build a tray app.

---

## IMMEDIATE FIX — Unblock the current EXE manually

While waiting for a certificate, allow the current EXE on your test machine:

```powershell
# Method 1: Unblock via PowerShell
Unblock-File -Path ".\Output\AdarshEngineSetup.exe"
Unblock-File -Path ".\dist\AdarshEngine.exe"

# Method 2: Right-click the file → Properties → "Unblock" checkbox at bottom

# Method 3: Temporarily disable SmartScreen for testing
# Settings → Windows Security → App & browser control → 
# Reputation-based protection → "Check apps and files" → OFF
# ⚠ Re-enable after testing!
```

---

## TESTING THE RUNNING SERVICE

Since `AdarshEngine.exe` is a **background service** (no window, `console=False`),
running it directly opens no visible window. Use these to verify it works:

```powershell
# Start directly (blocks terminal — press Ctrl+C to stop)
.\dist\AdarshEngine.exe

# In a new terminal, check if it's listening:
Invoke-WebRequest "http://127.0.0.1:4765/status"
# Expected: {"status":"running","version":"2.2.0"}

Invoke-WebRequest "http://127.0.0.1:4765/health"
# Expected: {"engine":"AdarshEngine","version":"2.2.0","status":"healthy",...}

# Double-click starts nothing visible — check port:
netstat -ano | findstr 4765
```

---

## BUILD CHECKLIST (before next release)

1. `python make_icon.py` — generate `adarsh_engine.ico` from `AdarshEngine.png`
2. Update version in: `VERSION.txt`, `version_info.txt`, `installer.iss`, `config.py`
3. `pyinstaller passport_engine.spec` — build `dist/AdarshEngine.exe`
4. `.\sign_self.ps1` — sign the EXE (or use commercial cert signtool)
5. `iscc installer.iss` — build `Output/AdarshEngineSetup.exe`
6. `.\sign_self.ps1` — sign the installer too
7. Test: unblock → run installer → verify service starts → `GET /status`
