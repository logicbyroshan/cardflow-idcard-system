; ═══════════════════════════════════════════════════════════════════════
;  installer.iss
;  ─────────────
;  Inno Setup script for Adarsh Cropper installer.
;
;  Company  : Adarsh ID Card
;  Developer: Roshan Damor
;
;  ANTI-VIRUS / SMARTSCREEN NOTES:
;    To avoid Windows Defender blocking the installer, you need a code
;    signing certificate.  The cheapest legitimate option:
;
;    1. Buy a Standard Code Signing cert (~$70/yr):
;       - Certum Open Source Code Signing (cheapest, ~$27/yr for OSS)
;       - SSL.com Basic ($75/yr)
;       - Sectigo Comodo ($85/yr)
;
;    2. OR get an EV Code Signing cert (~$300+/yr):
;       - Instant SmartScreen trust (no reputation building needed)
;       - Requires a hardware USB token (YubiKey / SafeNet)
;
;    Once you have a .pfx certificate file, set these GitHub Secrets:
;       SIGN_CERT_BASE64   — base64-encoded .pfx file
;       SIGN_CERT_PASSWORD  — password for the .pfx file
;
;    The CI workflow will automatically sign both AdarshCropper.exe
;    and AdarshCropperSetup.exe.
;
;  Prerequisites:
;    - Build AdarshCropper.exe via PyInstaller first.
;    - Place nssm.exe (64-bit) alongside this script OR in dist/.
;    - Inno Setup 6.x: https://jrsoftware.org/isinfo.php
;
;  Compile:
;    iscc installer.iss
;
;  Output:
;    Output/AdarshCropperSetup.exe
; ═══════════════════════════════════════════════════════════════════════

#define MyAppName "Adarsh Cropper"
#define MyAppVersion "2.1.8"
#define MyAppPublisher "Adarsh ID Card"
#define MyAppCopyright "© 2026 Adarsh ID Card. Developed by Roshan Damor."
#define MyAppExeName "AdarshCropper.exe"
#define MyServiceName "AdarshCropper"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppCopyright={#MyAppCopyright}
VersionInfoVersion=2.1.8.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Adarsh Cropper — Photo Processing Engine by Adarsh ID Card
VersionInfoProductName={#MyAppName}
VersionInfoCopyright={#MyAppCopyright}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=AdarshCropperSetup
SetupIconFile=adarsh_cropper.ico
UninstallDisplayIcon={app}\{#MyAppExeName},0
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
CreateUninstallRegKey=yes
Uninstallable=yes

; Code signing — uncomment SignTool when you have a certificate.
; Configure via: Inno Setup → Tools → Configure Sign Tools
;   Name: signtool
;   Command: signtool.exe sign /f "$qcert.pfx$q" /p $qPASSWORD$q /fd sha256 /tr http://timestamp.digicert.com /td sha256 $f
;
; SignTool=signtool

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Main executable (built by PyInstaller)
Source: "dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

; VERSION.txt
Source: "VERSION.txt"; DestDir: "{app}"; Flags: ignoreversion

; NSSM (Non-Sucking Service Manager) — 64-bit binary
; Download from https://nssm.cc/download and place nssm.exe here
Source: "nssm.exe"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\logs"

[Code]
var
  OutputDirPage: TInputDirWizardPage;

procedure InitializeWizard();
begin
  { Custom page: let user choose where cropped photos are saved }
  OutputDirPage := CreateInputDirPage(
    wpSelectDir,
    'Output Folder for Cropped Photos',
    'Where should cropped photos be saved?',
    'Select the folder where Adarsh Cropper will save cropped photos by default.' + #13#10 +
    'You can change this later from the panel.',
    False, ''
  );
  OutputDirPage.Add('');
  OutputDirPage.Values[0] := ExpandConstant('{userdocs}\AdarshCropper Output');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigFile: String;
  OutputDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    { Write the chosen output directory to config file }
    OutputDir := OutputDirPage.Values[0];
    if OutputDir <> '' then
    begin
      ForceDirectories(OutputDir);
      ConfigFile := ExpandConstant('{app}\output_config.ini');
      SaveStringToFile(ConfigFile, '[output]' + #13#10 + 'directory = ' + OutputDir + #13#10, False);
    end;
  end;
end;

[Run]
; ── Stop old service (if upgrading) ──────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "stop {#MyServiceName}"; \
    Flags: runhidden nowait; StatusMsg: "Stopping existing service..."

; ── Also stop legacy service name if upgrading from old version ──────
Filename: "{app}\nssm.exe"; Parameters: "stop PassportEngine"; \
    Flags: runhidden nowait; StatusMsg: "Stopping legacy service..."

; ── Remove old service (if upgrading) ────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "remove {#MyServiceName} confirm"; \
    Flags: runhidden; StatusMsg: "Removing old service..."

; ── Remove legacy service name if present ────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "remove PassportEngine confirm"; \
    Flags: runhidden; StatusMsg: "Removing legacy service..."

; ── Install service ──────────────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "install {#MyServiceName} ""{app}\{#MyAppExeName}"""; \
    Flags: runhidden; StatusMsg: "Installing service..."

; ── Configure service ────────────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} DisplayName ""Adarsh Cropper — Photo Processing Engine"""; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} Description ""Adarsh Cropper — Local Photo Processing Engine - API on 127.0.0.1:4765"""; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} Start SERVICE_AUTO_START"; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} ObjectName LocalSystem"; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppExit Default Restart"; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppRestartDelay 5000"; \
    Flags: runhidden

; ── Environment ──────────────────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppEnvironmentExtra PASSPORT_ENGINE_MODE=service"; \
    Flags: runhidden

; ── Logging ──────────────────────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppStdout ""{app}\logs\service.log"""; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppStderr ""{app}\logs\error.log"""; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppRotateFiles 1"; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppRotateBytes 5242880"; \
    Flags: runhidden

; ── Start service ────────────────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "start {#MyServiceName}"; \
    Flags: runhidden; StatusMsg: "Starting service..."

[UninstallRun]
; ── Stop and remove service on uninstall ─────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "stop {#MyServiceName}"; \
    Flags: runhidden; RunOnceId: "StopService"
Filename: "{app}\nssm.exe"; Parameters: "remove {#MyServiceName} confirm"; \
    Flags: runhidden; RunOnceId: "RemoveService"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}"
