; ═══════════════════════════════════════════════════════════════════════
;  PassportEngine.iss — Inno Setup script
;  Builds: PassportEngineSetup.exe
;
;  What it does:
;    • Installs PassportEngine.exe + nssm.exe + models to Program Files
;    • Registers a Windows Service (auto-start, crash-restart)
;    • Sets PASSPORT_ENGINE_MODE=service environment
;    • Creates logs directory
;    • Adds standard Add/Remove Programs entry
;    • On uninstall: stops service, removes service, deletes files
; ═══════════════════════════════════════════════════════════════════════

#define MyAppName      "PassportEngine"
#define MyAppVersion   "1.0.0"
#define MyAppPublisher "PassportEngine"
#define MyAppExeName   "PassportEngine.exe"

[Setup]
AppId={{A9E6B8E1-0C5E-4A1C-9E0D-ENGINE-4765}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={commonpf}\{#MyAppName}
DefaultGroupName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} {#MyAppVersion}
Compression=lzma2
SolidCompression=yes
OutputDir=.
OutputBaseFilename=PassportEngineSetup
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
DisableProgramGroupPage=yes
DisableDirPage=yes
SetupLogging=yes
CloseApplications=no

; No Start-Menu shortcuts, no desktop icon, no readme
CreateUninstallRegKey=yes

[Dirs]
Name: "{app}\logs"; Permissions: everyone-full
Name: "{app}\models"

[Files]
Source: "PassportEngine.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "VERSION.txt";        DestDir: "{app}"; Flags: ignoreversion
Source: "nssm.exe";           DestDir: "{app}"; Flags: ignoreversion
Source: "models\*";           DestDir: "{app}\models"; Flags: ignoreversion recursesubdirs

[Run]
; ── Stop & remove any previous service (idempotent) ──────────
Filename: "{app}\nssm.exe"; Parameters: "stop PassportEngine";           Flags: runhidden waituntilterminated; StatusMsg: "Stopping previous service..."
Filename: "{app}\nssm.exe"; Parameters: "remove PassportEngine confirm"; Flags: runhidden waituntilterminated; StatusMsg: "Removing previous service..."

; ── Install service ──────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "install PassportEngine ""{app}\{#MyAppExeName}"""; Flags: runhidden waituntilterminated; StatusMsg: "Installing service..."

; ── Configure service ────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine DisplayName ""Passport Photo Processing Engine"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine Description ""Local Passport Photo Engine — API on 127.0.0.1:4765"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine Start SERVICE_AUTO_START";         Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine ObjectName LocalSystem";           Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine AppEnvironmentExtra PASSPORT_ENGINE_MODE=service"; Flags: runhidden waituntilterminated

; ── Crash recovery ───────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine AppExit Default Restart";          Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine AppRestartDelay 5000";             Flags: runhidden waituntilterminated

; ── NSSM stdout/stderr logging ───────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine AppStdout ""{app}\logs\service.log""";  Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine AppStderr ""{app}\logs\error.log""";    Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine AppStdoutCreationDisposition 4";   Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine AppStderrCreationDisposition 4";   Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine AppRotateFiles 1";                 Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set PassportEngine AppRotateBytes 5242880";           Flags: runhidden waituntilterminated

; ── Start the service ────────────────────────────────────────
Filename: "{app}\nssm.exe"; Parameters: "start PassportEngine"; Flags: runhidden waituntilterminated; StatusMsg: "Starting PassportEngine service..."

[UninstallRun]
; Stop and remove the service before files are deleted
Filename: "{app}\nssm.exe"; Parameters: "stop PassportEngine";           Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "remove PassportEngine confirm"; Flags: runhidden waituntilterminated

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
