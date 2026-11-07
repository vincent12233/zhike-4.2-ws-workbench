#ifndef AppVersion
#define AppVersion "5.0.0"
#endif
#ifndef StageDir
#define StageDir "work\\winui-bundle\\zhike-winui-5.0.0-win-x64"
#endif
#ifndef BuildOutputDir
#define BuildOutputDir "work\\winui-installer-output"
#endif

[Setup]
AppId={{8A2E0A65-B5C8-4F74-9DD9-7AC4CE0A50B3}
AppName=知客原生桌面版
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}.0
DefaultDirName={localappdata}\Programs\ZhikeNative
DefaultGroupName=知客原生桌面版
PrivilegesRequired=lowest
OutputDir={#BuildOutputDir}
OutputBaseFilename=知客-{#AppVersion}-WinUI桌面版
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
DisableProgramGroupPage=yes
SetupLogging=yes
UninstallDisplayIcon={app}\Zhike.Desktop.exe

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\知客原生桌面版"; Filename: "{app}\Zhike.Desktop.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\知客原生桌面版"; Filename: "{app}\Zhike.Desktop.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Zhike.Desktop.exe"; Description: "启动知客原生桌面版"; Flags: nowait postinstall skipifsilent

; User data is stored below %LOCALAPPDATA%\\Zhike and is intentionally not removed on uninstall.
