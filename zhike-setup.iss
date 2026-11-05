[Setup]
AppId={{C3EDBD10-E7B9-4C06-A297-6184F7DDE410}
AppName=知客运营工作台
AppVersion=4.2.0
DefaultDirName={localappdata}\Programs\Zhike
DefaultGroupName=知客运营工作台
PrivilegesRequired=lowest
OutputDir=..\outputs
OutputBaseFilename=知客-4.2-WS工作台版
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\知客离线工作台.exe
CloseApplications=yes
RestartApplications=no
DisableProgramGroupPage=yes
SetupLogging=yes

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："

[Files]
Source: "project-review\知客 4.1 运营增强版\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "resources\app\data\*"

[Icons]
Name: "{group}\知客运营工作台"; Filename: "{app}\知客离线工作台.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\知客运营工作台"; Filename: "{app}\知客离线工作台.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\知客离线工作台.exe"; Description: "启动知客运营工作台"; Flags: nowait postinstall skipifsilent

; No AppData uninstall-delete rule: user databases and backups are retained.
