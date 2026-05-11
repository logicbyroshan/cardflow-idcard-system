# ═══════════════════════════════════════════════════════════════════════
#  sign_self.ps1
#  ─────────────
#  Creates a self-signed code signing certificate and signs both
#  AdarshEngine.exe and AdarshEngineSetup.exe.
#
#  PURPOSE:
#    Removes "Unknown Publisher" in standard Windows dialogs.
#    Does NOT remove the Windows SmartScreen "Windows protected your PC"
#    warning (SmartScreen requires a commercial cert + reputation).
#    See CODE_SIGNING.md for how to fix SmartScreen completely.
#
#  USAGE — run once on your build machine (Run as Administrator):
#    .\sign_self.ps1
#
#  Then distribute. The certificate trusts ONLY your own machine
#  unless you import the .cer into other machines' Trusted Publishers.
# ═══════════════════════════════════════════════════════════════════════

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

# ── Config ───────────────────────────────────────────────────────────────
$Subject     = "CN=Adarsh ID Card, O=Adarsh ID Card, L=Bhopal, S=MP, C=IN"
$FriendlyName = "Adarsh Engine Code Signing (Self-Signed)"
$ExpiryYears  = 3
$PfxPassword  = ConvertTo-SecureString "AdarshEngine2026!" -AsPlainText -Force
$PfxPath      = "$PSScriptRoot\adarsh_engine_selfsign.pfx"
$CerPath      = "$PSScriptRoot\adarsh_engine_selfsign.cer"

# ── Files to sign ────────────────────────────────────────────────────────
$FilesToSign = @(
    "$PSScriptRoot\dist\AdarshEngine.exe",
    "$PSScriptRoot\Output\AdarshEngineSetup.exe"
)

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Adarsh Engine — Self-Sign Script   " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Create certificate ───────────────────────────────────────────
Write-Host "[1/5] Creating self-signed code-signing certificate..." -ForegroundColor Yellow

$cert = New-SelfSignedCertificate `
    -Subject $Subject `
    -FriendlyName $FriendlyName `
    -Type CodeSigning `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 4096 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears($ExpiryYears) `
    -CertStoreLocation "Cert:\CurrentUser\My"

Write-Host "   Created: $($cert.Thumbprint)" -ForegroundColor Green

# ── Step 2: Export PFX (private key + cert) ──────────────────────────────
Write-Host "[2/5] Exporting PFX to $PfxPath ..." -ForegroundColor Yellow
Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $PfxPassword | Out-Null
Write-Host "   Exported: $PfxPath" -ForegroundColor Green

# ── Step 3: Export public .cer (for import on other machines) ────────────
Write-Host "[3/5] Exporting public certificate to $CerPath ..." -ForegroundColor Yellow
Export-Certificate -Cert $cert -FilePath $CerPath | Out-Null
Write-Host "   Exported: $CerPath" -ForegroundColor Green

# ── Step 4: Trust the cert on THIS machine ───────────────────────────────
Write-Host "[4/5] Trusting certificate on this machine..." -ForegroundColor Yellow

# TrustedPublisher — needed for Authenticode trust
Import-Certificate -FilePath $CerPath -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher" | Out-Null
# Root CA — suppresses untrusted issuer warning
Import-Certificate -FilePath $CerPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null

Write-Host "   Trusted in LocalMachine\TrustedPublisher and LocalMachine\Root" -ForegroundColor Green

# ── Step 5: Sign files ───────────────────────────────────────────────────
Write-Host "[5/5] Signing files..." -ForegroundColor Yellow

# Locate signtool.exe
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits" -Recurse -Filter "signtool.exe" `
    -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match "x64" } |
    Select-Object -Last 1 | Select-Object -ExpandProperty FullName

if (-not $signtool) {
    Write-Host ""
    Write-Host "WARNING: signtool.exe not found (install Windows SDK)." -ForegroundColor Red
    Write-Host "   Using Set-AuthenticodeSignature (PowerShell) instead..." -ForegroundColor Yellow
    Write-Host ""

    foreach ($file in $FilesToSign) {
        if (Test-Path $file) {
            Set-AuthenticodeSignature -FilePath $file -Certificate $cert `
                -HashAlgorithm SHA256 -TimestampServer "http://timestamp.digicert.com" | Out-Null
            Write-Host "   Signed: $file" -ForegroundColor Green
        } else {
            Write-Host "   SKIP (not found): $file" -ForegroundColor DarkGray
        }
    }
} else {
    # Decode PFX password back to plain text for signtool
    $bstr   = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($PfxPassword)
    $pwPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

    foreach ($file in $FilesToSign) {
        if (Test-Path $file) {
            & $signtool sign `
                /f $PfxPath `
                /p $pwPlain `
                /fd SHA256 `
                /tr "http://timestamp.digicert.com" `
                /td SHA256 `
                /d "Adarsh Engine - Photo Processing Engine" `
                /du "https://adarshbhopal.in" `
                $file

            Write-Host "   Signed: $file" -ForegroundColor Green
        } else {
            Write-Host "   SKIP (not found): $file" -ForegroundColor DarkGray
        }
    }

    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

# ── Summary ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "  Done!                               " -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""
Write-Host "Certificate details:" -ForegroundColor Cyan
Write-Host "  Thumbprint : $($cert.Thumbprint)"
Write-Host "  Expires    : $($cert.NotAfter.ToShortDateString())"
Write-Host "  PFX file   : $PfxPath"
Write-Host "  CER file   : $CerPath (share this to trust on other machines)"
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. Run 'make_icon.py' to generate adarsh_engine.ico from AdarshEngine.png"
Write-Host "  2. Build the EXE:  pyinstaller passport_engine.spec"
Write-Host "  3. Build installer: iscc installer.iss"
Write-Host "  4. Run sign_self.ps1 again after each build to re-sign"
Write-Host ""
Write-Host "NOTE: Self-signed certs do NOT fix Windows SmartScreen blue-screen."
Write-Host "      See CODE_SIGNING.md for options to fix SmartScreen permanently."
Write-Host ""
