#ifndef AppVersion
#define AppVersion "5.3.2"
#endif
#ifndef StageDir
#define StageDir "work\\winui-bundle\\zhike-winui-5.3.2-win-x64"
#endif
#ifndef BuildOutputDir
#define BuildOutputDir "work\\winui-installer-output"
#endif
#ifndef IconFile
#define IconFile "desktop\\src\\Zhike.Desktop\\Assets\\zhike.ico"
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
SetupIconFile={#IconFile}
CloseApplications=yes
RestartApplications=no
DisableProgramGroupPage=yes
SetupLogging=yes
UninstallDisplayIcon={app}\zhike.ico

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\知客原生桌面版"; Filename: "{app}\Zhike.Desktop.exe"; IconFilename: "{app}\zhike.ico"; IconIndex: 0; WorkingDir: "{app}"
Name: "{autodesktop}\知客原生桌面版"; Filename: "{app}\Zhike.Desktop.exe"; IconFilename: "{app}\zhike.ico"; IconIndex: 0; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Zhike.Desktop.exe"; Description: "启动知客原生桌面版"; Flags: nowait postinstall skipifsilent

; User data is stored below %LOCALAPPDATA%\\Zhike and is intentionally not removed on uninstall.

[Code]
function HasWebView2Runtime(): Boolean;
var
  SubKeys: TArrayOfString;
  I: Integer;
  ClientKey: String;
  ProductName: String;
begin
  Result := False;
  if RegGetSubkeyNames(HKCU, 'Software\Microsoft\EdgeUpdate\Clients', SubKeys) then
    for I := 0 to GetArrayLength(SubKeys) - 1 do begin
      ClientKey := 'Software\Microsoft\EdgeUpdate\Clients\' + SubKeys[I];
      if RegQueryStringValue(HKCU, ClientKey, 'name', ProductName) and
         (Pos('WebView2', ProductName) > 0) and RegValueExists(HKCU, ClientKey, 'pv') then begin
        Result := True;
        Exit;
      end;
    end;
  if RegGetSubkeyNames(HKLM, 'Software\Microsoft\EdgeUpdate\Clients', SubKeys) then
    for I := 0 to GetArrayLength(SubKeys) - 1 do begin
      ClientKey := 'Software\Microsoft\EdgeUpdate\Clients\' + SubKeys[I];
      if RegQueryStringValue(HKLM, ClientKey, 'name', ProductName) and
         (Pos('WebView2', ProductName) > 0) and RegValueExists(HKLM, ClientKey, 'pv') then begin
        Result := True;
        Exit;
      end;
    end;
  if RegGetSubkeyNames(HKLM, 'Software\WOW6432Node\Microsoft\EdgeUpdate\Clients', SubKeys) then
    for I := 0 to GetArrayLength(SubKeys) - 1 do begin
      ClientKey := 'Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + SubKeys[I];
      if RegQueryStringValue(HKLM, ClientKey, 'name', ProductName) and
         (Pos('WebView2', ProductName) > 0) and RegValueExists(HKLM, ClientKey, 'pv') then begin
        Result := True;
        Exit;
      end;
    end;
end;

function InitializeSetup(): Boolean;
var
  Choice: Integer;
  ErrorCode: Integer;
begin
  Result := True;
  if not HasWebView2Runtime() then begin
    Choice := MsgBox('未检测到 Microsoft Edge WebView2 Evergreen Runtime。知客可以继续安装，但 WS 与业务页面需要此运行时。是否现在打开微软官方下载页？', mbConfirmation, MB_YESNO);
    if Choice = IDYES then
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;
