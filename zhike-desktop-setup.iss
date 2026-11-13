#ifndef AppVersion
#define AppVersion "6.0.0"
#endif
#ifndef StageDir
#define StageDir "work\\winui-bundle\\zhike-winui-6.0.0-win-x64"
#endif
#ifndef BuildOutputDir
#define BuildOutputDir "work\\winui-installer-output"
#endif
#ifndef IconFile
#define IconFile "desktop\\src\\Zhike.Desktop\\Assets\\zhike.ico"
#endif

[Setup]
AppId={{8A2E0A65-B5C8-4F74-9DD9-7AC4CE0A50B3}
AppName=知客工作台
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}.0
DefaultDirName={localappdata}\Programs\ZhikeNative
DefaultGroupName=知客工作台
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
UninstallDisplayIcon={app}\zhike-horizon-6.ico

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; A versioned shortcut icon path prevents Windows Explorer from reusing the
; cached blue pre-6.0 tile after an in-place upgrade.
Source: "{#StageDir}\zhike.ico"; DestDir: "{app}"; DestName: "zhike-horizon-6.ico"; Flags: ignoreversion

[InstallDelete]
; 6.0.0 keeps a single desktop entry. These names were created by earlier
; WinUI packages and point to the same executable, so retaining them makes one
; installed product look like multiple clients.
Type: files; Name: "{autodesktop}\知客原生桌面版.lnk"
Type: files; Name: "{autodesktop}\知客桌面版.lnk"
Type: files; Name: "{autodesktop}\知客兼容回滚（旧版）.lnk"
Type: files; Name: "{autodesktop}\知客运营工作台.lnk"
Type: files; Name: "{userprograms}\知客运营工作台\知客运营工作台.lnk"
Type: dirifempty; Name: "{userprograms}\知客运营工作台"
; Remove application-only debris left by older packages before copying the
; current manifest.  The 6.0 database lives under %LOCALAPPDATA%\Zhike6 and
; is deliberately outside {app}; no new or historical user data, backups or
; credentials are matched by this allow-list.
Type: files; Name: "{app}\release-notes-5.2.0.md"
Type: files; Name: "{app}\release-notes-5.3.0.md"
Type: files; Name: "{app}\release-notes-5.3.1.md"
Type: files; Name: "{app}\release-notes-5.3.2.md"
Type: files; Name: "{app}\release-notes-5.3.3.md"
Type: files; Name: "{app}\release-notes-5.3.4.md"
Type: files; Name: "{app}\release-notes-5.3.5.md"
Type: files; Name: "{app}\release-notes-5.3.6.md"
Type: files; Name: "{app}\release-notes-5.3.7.md"
Type: files; Name: "{app}\release-notes-5.3.8.md"
Type: files; Name: "{app}\release-notes-5.3.9.md"
Type: files; Name: "{app}\release-notes-5.3.10.md"
Type: files; Name: "{app}\release-notes-5.3.11.md"
Type: files; Name: "{app}\release-notes-5.3.12.md"
Type: files; Name: "{app}\release-notes-5.3.13.md"
Type: files; Name: "{app}\release-notes-5.3.14.md"
Type: files; Name: "{app}\release-notes-5.3.15.md"
Type: files; Name: "{app}\release-notes-5.3.16.md"
Type: files; Name: "{app}\release-notes-5.3.17.md"
Type: files; Name: "{app}\release-notes-5.3.18.md"
Type: files; Name: "{app}\test-report-5.3.9.md"
Type: files; Name: "{app}\server-version-deployment.md"
Type: files; Name: "{app}\server-version-troubleshooting.md"
Type: files; Name: "{app}\migrations\5.3.17-ws-timestamp-provenance.sql"
Type: dirifempty; Name: "{app}\migrations"
Type: files; Name: "{app}\resources\app\modules\operations-core.test.cjs"
Type: files; Name: "{app}\resources\app\modules\phone-registry-seed.json"

[Icons]
Name: "{group}\知客工作台"; Filename: "{app}\Zhike.Desktop.exe"; IconFilename: "{app}\zhike-horizon-6.ico"; IconIndex: 0; WorkingDir: "{app}"
; The formal desktop build always creates a desktop shortcut.  The previous
; optional task defaulted to unchecked, which made users think installation
; had failed even though the app was installed under LocalAppData.
Name: "{autodesktop}\知客工作台"; Filename: "{app}\Zhike.Desktop.exe"; IconFilename: "{app}\zhike-horizon-6.ico"; IconIndex: 0; WorkingDir: "{app}"

[Run]
Filename: "{app}\Zhike.Desktop.exe"; Description: "启动知客工作台"; Flags: nowait postinstall skipifsilent

; 6.0 data is stored below %LOCALAPPDATA%\\Zhike6. The installer neither reads
; nor removes the historical %LOCALAPPDATA%\\Zhike directory.

[Code]
const
  PreviousElectronUninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{C3EDBD10-E7B9-4C06-A297-6184F7DDE410}_is1';

function QueryPreviousElectronUninstaller(var CommandLine: String): Boolean;
begin
  Result := RegQueryStringValue(HKCU, PreviousElectronUninstallKey, 'QuietUninstallString', CommandLine);
  if not Result then
    Result := RegQueryStringValue(HKCU, PreviousElectronUninstallKey, 'UninstallString', CommandLine);
  if not Result then
    Result := RegQueryStringValue(HKLM, PreviousElectronUninstallKey, 'QuietUninstallString', CommandLine);
  if not Result then
    Result := RegQueryStringValue(HKLM, PreviousElectronUninstallKey, 'UninstallString', CommandLine);
end;

procedure SplitUninstallCommand(CommandLine: String; var Filename: String; var Parameters: String);
var
  ClosingQuote: Integer;
  Separator: Integer;
begin
  Filename := '';
  Parameters := '';
  CommandLine := Trim(CommandLine);
  if CommandLine = '' then
    Exit;
  if CommandLine[1] = '"' then begin
    Delete(CommandLine, 1, 1);
    ClosingQuote := Pos('"', CommandLine);
    if ClosingQuote > 0 then begin
      Filename := Copy(CommandLine, 1, ClosingQuote - 1);
      Parameters := Trim(Copy(CommandLine, ClosingQuote + 1, Length(CommandLine)));
      Exit;
    end;
  end;
  Separator := Pos(' ', CommandLine);
  if Separator > 0 then begin
    Filename := Copy(CommandLine, 1, Separator - 1);
    Parameters := Trim(Copy(CommandLine, Separator + 1, Length(CommandLine)));
  end else
    Filename := CommandLine;
end;

function RetirePreviousElectronClient(): Boolean;
var
  CommandLine: String;
  Filename: String;
  Parameters: String;
  ExitCode: Integer;
begin
  Result := True;
  ExitCode := -1;
  if not QueryPreviousElectronUninstaller(CommandLine) then
    Exit;
  SplitUninstallCommand(CommandLine, Filename, Parameters);
  if (Filename = '') or (not FileExists(Filename)) then begin
    Log('Previous Electron uninstall entry exists but its uninstaller is missing.');
    Result := False;
    Exit;
  end;
  if Pos('/VERYSILENT', Uppercase(Parameters)) = 0 then
    Parameters := Parameters + ' /VERYSILENT';
  if Pos('/SUPPRESSMSGBOXES', Uppercase(Parameters)) = 0 then
    Parameters := Parameters + ' /SUPPRESSMSGBOXES';
  if Pos('/NORESTART', Uppercase(Parameters)) = 0 then
    Parameters := Parameters + ' /NORESTART';
  Log('Retiring the previous Electron client while preserving its external user-data directories.');
  Result := Exec(Filename, Trim(Parameters), '', SW_HIDE, ewWaitUntilTerminated, ExitCode) and (ExitCode = 0);
  if not Result then
    Log(Format('Previous Electron uninstaller failed with exit code %d.', [ExitCode]));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not RetirePreviousElectronClient() then
    Result := '检测到旧版知客客户端，但未能安全卸载。请先在 Windows“已安装的应用”中卸载“知客运营工作台”，再重新运行 6.0 安装程序。旧版数据目录不会被读取、迁移或删除。';
end;

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
