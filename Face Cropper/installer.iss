; ═══════════════════════════════════════════════════════════════════════
;  installer.iss
;  ─────────────
;  Inno Setup script for Photo Cropper (PassportEngine) installer.
;
;  Company  : Adarsh ID Card
;  Developer: Roshan Damor
;
;  Prerequisites:
;    - Build PassportEngine.exe via PyInstaller first.
;    - Place nssm.exe (64-bit) alongside this script OR in dist/.
;    - Inno Setup 6.x: https://jrsoftware.org/isinfo.php
;
;  Compile:
;    iscc installer.iss
;
;  Output:
;    Output/PhotoCropperSetup.exe
; ═══════════════════════════════════════════════════════════════════════

#define MyAppName "Photo Cropper"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Adarsh ID Card"
#define MyAppCopyright "© 2026 Adarsh ID Card. Developed by Roshan Damor."
#define MyAppExeName "PassportEngine.exe"
#define MyServiceName "PassportEngine"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppCopyright={#MyAppCopyright}
VersionInfoVersion=2.0.0.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Passport Photo Cropping Engine by Adarsh ID Card
VersionInfoProductName={#MyAppName}
VersionInfoCopyright={#MyAppCopyright}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=PhotoCropperSetup
SetupIconFile=app_icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName},0
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
WizardImageFile=compiler:WizModernImage-IS.bmp
WizardSmallImageFile=compiler:WizModernSmallImage-IS.bmp
CreateUninstallRegKey=yes
Uninstallable=yes

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

[Run]
; ── Stop old service (if upgrading) ──────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "stop {#MyServiceName}"; \
    Flags: runhidden nowait; StatusMsg: "Stopping existing service..."

; ── Remove old service (if upgrading) ────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "remove {#MyServiceName} confirm"; \
    Flags: runhidden; StatusMsg: "Removing old service..."

; ── Install service ──────────────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "install {#MyServiceName} ""{app}\{#MyAppExeName}"""; \
    Flags: runhidden; StatusMsg: "Installing service..."

; ── Configure service ────────────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} DisplayName ""Passport Photo Processing Engine"""; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} Description ""Local Passport Photo Processing Engine - API on 127.0.0.1:4765"""; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} Start SERVICE_AUTO_START"; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} ObjectName LocalSystem"; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppExit Default Restart"; \
    Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppRestartDelay 5000"; \
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
