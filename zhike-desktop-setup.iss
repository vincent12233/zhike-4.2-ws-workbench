#ifndef AppVersion
#define AppVersion "6.1.0"
#endif
#ifndef StageDir
#define StageDir "work\\winui-bundle\\zhike-winui-6.1.0-win-x64"
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
MinVersion=10.0.22621
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile={#IconFile}
CloseApplications=yes
RestartApplications=no
DisableProgramGroupPage=yes
SetupLogging=yes
UninstallDisplayIcon={app}\zhike-horizon-6-1-0.ico

[Languages]
Name: "chinesesimp"; MessagesFile: "installer\ChineseSimplified.isl"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; A versioned shortcut icon path prevents Windows Explorer from reusing the
; cached blue pre-6.0 tile after an in-place upgrade.
Source: "{#StageDir}\zhike.ico"; DestDir: "{app}"; DestName: "zhike-horizon-6-1-0.ico"; Flags: ignoreversion

[InstallDelete]
; All business data and credentials live outside {app}, under the isolated
; %LOCALAPPDATA%\Zhike6 data root. Replacing these application-only payloads
; prevents removed 4.x/5.x modules or runtime assemblies from surviving an
; in-place upgrade and being mistaken for part of the current product.
Type: filesandordirs; Name: "{app}\resources"; Check: IsVerifiedUpgradeDirectory
Type: filesandordirs; Name: "{app}\migrations"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\Zhike.Desktop.exe"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\node.exe"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\*.dll"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\*.deps.json"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\*.runtimeconfig.json"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\*.pdb"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\*.pri"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\*.winmd"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\zhike*.ico"; Check: IsVerifiedUpgradeDirectory
; Keep a single desktop entry. These names were created by earlier
; WinUI packages and point to the same executable, so retaining them makes one
; installed product look like multiple clients.
Type: files; Name: "{autodesktop}\知客原生桌面版.lnk"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{autodesktop}\知客桌面版.lnk"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{autodesktop}\知客兼容回滚（旧版）.lnk"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{autodesktop}\知客运营工作台.lnk"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{userprograms}\知客兼容回滚（旧版）.lnk"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{userprograms}\知客原生桌面版\知客工作台.lnk"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{userprograms}\知客原生桌面版\知客原生桌面版.lnk"; Check: IsVerifiedUpgradeDirectory
Type: dirifempty; Name: "{userprograms}\知客原生桌面版"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{userprograms}\知客运营工作台\知客运营工作台.lnk"; Check: IsVerifiedUpgradeDirectory
Type: dirifempty; Name: "{userprograms}\知客运营工作台"; Check: IsVerifiedUpgradeDirectory
; Remove application-only debris left by older packages before copying the
; current manifest.  The 6.0 database lives under %LOCALAPPDATA%\Zhike6 and
; is deliberately outside {app}; no new or historical user data, backups or
; credentials are matched by this allow-list.
Type: files; Name: "{app}\release-notes-5.2.0.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.0.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.1.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.2.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.3.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.4.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.5.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.6.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.7.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.8.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.9.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.10.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.11.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.12.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.13.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.14.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.15.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.16.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.17.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-5.3.18.md"; Check: IsVerifiedUpgradeDirectory
; Remove obsolete release notes from prior 5.4/6.0.0/6.0.1 packages so an
; in-place upgrade leaves one coherent application payload. User data
; remains outside {app} under %LOCALAPPDATA%\Zhike6 and is not touched.
Type: files; Name: "{app}\release-notes-5.4.0.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-6.0.0.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\release-notes-6.0.1.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\test-report-5.3.9.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\server-version-deployment.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\server-version-troubleshooting.md"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\migrations\5.3.17-ws-timestamp-provenance.sql"; Check: IsVerifiedUpgradeDirectory
Type: dirifempty; Name: "{app}\migrations"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\resources\app\modules\operations-core.test.cjs"; Check: IsVerifiedUpgradeDirectory
Type: files; Name: "{app}\resources\app\modules\phone-registry-seed.json"; Check: IsVerifiedUpgradeDirectory

[Icons]
Name: "{group}\知客工作台"; Filename: "{app}\Zhike.Desktop.exe"; IconFilename: "{app}\zhike-horizon-6-1-0.ico"; IconIndex: 0; WorkingDir: "{app}"
; The formal desktop build always creates a desktop shortcut.  The previous
; optional task defaulted to unchecked, which made users think installation
; had failed even though the app was installed under LocalAppData.
Name: "{autodesktop}\知客工作台"; Filename: "{app}\Zhike.Desktop.exe"; IconFilename: "{app}\zhike-horizon-6-1-0.ico"; IconIndex: 0; WorkingDir: "{app}"

[Run]
Filename: "{app}\Zhike.Desktop.exe"; Description: "启动知客工作台"; Flags: nowait postinstall skipifsilent

; 6.0 data is stored below %LOCALAPPDATA%\\Zhike6. The installer neither reads
; nor removes the historical %LOCALAPPDATA%\\Zhike directory.

[Code]
const
  WebView2ClientKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  PreviousElectronUninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{C3EDBD10-E7B9-4C06-A297-6184F7DDE410}_is1';
  CurrentNativeUninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8A2E0A65-B5C8-4F74-9DD9-7AC4CE0A50B3}_is1';
  PathTypeDirectory = $10;
  PathTypeReparse = $400;
  InvalidPathAttributes = $FFFFFFFF;

var
  VerifiedUpgradePath: String;

function GetPathAttributes(const Filename: String): DWORD;
  external 'GetFileAttributesW@kernel32.dll stdcall';

function NormalizeLocalDirectory(Value: String): String;
begin
  Result := '';
  Value := Trim(Value);
  if Length(Value) < 3 then Exit;
  if (Value[2] <> ':') or (Value[3] <> '\') or (Pos(':', Copy(Value, 3, Length(Value))) <> 0) then Exit;
  Value := RemoveBackslashUnlessRoot(ExpandFileName(Value));
  if (Length(Value) <= 3) or (Pos('.\', Value) <> 0) or (Pos(' \', Value) <> 0) then Exit;
  if (Value[Length(Value)] = '.') or (Value[Length(Value)] = ' ') then Exit;
  Result := Value;
end;

function DirectoryAtOrBelow(const Directory, Root: String): Boolean;
begin
  Result := SameText(Directory, Root) or SameText(Copy(Directory, 1, Length(Root) + 1), AddBackslash(Root));
end;

function IsSafeInstallDirectory(const Directory: String): Boolean;
var
  Parent: String;
  Attributes: DWORD;
  ErrorCode: Integer;
begin
  Result := False;
  if Directory = '' then Exit;
  if DirectoryAtOrBelow(Directory, ExpandConstant('{win}')) or
     DirectoryAtOrBelow(Directory, ExpandConstant('{localappdata}\Zhike')) or
     DirectoryAtOrBelow(Directory, ExpandConstant('{localappdata}\Zhike6')) or
     SameText(Directory, ExpandConstant('{localappdata}')) or
     SameText(Directory, GetEnv('USERPROFILE')) then Exit;
  Parent := Directory;
  repeat
    Attributes := GetPathAttributes(Parent);
    if Attributes = InvalidPathAttributes then begin
      ErrorCode := DLLGetLastError();
      { Only file-not-found and path-not-found identify a new path. }
      if (ErrorCode <> 2) and (ErrorCode <> 3) then Exit;
    end else if ((Attributes and PathTypeDirectory) = 0) or ((Attributes and PathTypeReparse) <> 0) then
      Exit;
    if Length(Parent) <= 3 then Break;
    Parent := ExtractFileDir(Parent);
  until Parent = '';
  Result := True;
end;

function DirectoryIsEmpty(const Directory: String): Boolean;
var
  Entry: TFindRec;
begin
  Result := not DirExists(Directory);
  if Result then Exit;
  if not FindFirst(AddBackslash(Directory) + '*', Entry) then Exit;
  try
    repeat
      if (Entry.Name <> '.') and (Entry.Name <> '..') then Exit;
    until not FindNext(Entry);
    Result := True;
  finally
    FindClose(Entry);
  end;
end;

function DirectoryTreeHasNoReparsePoints(const Directory: String): Boolean;
var
  Entry: TFindRec;
begin
  Result := False;
  if not FindFirst(AddBackslash(Directory) + '*', Entry) then Exit;
  try
    repeat
      if (Entry.Name <> '.') and (Entry.Name <> '..') then begin
        if (Entry.Attributes and PathTypeReparse) <> 0 then Exit;
        if (Entry.Attributes and PathTypeDirectory) <> 0 then
          if not DirectoryTreeHasNoReparsePoints(AddBackslash(Directory) + Entry.Name) then Exit;
      end;
    until not FindNext(Entry);
    Result := True;
  finally
    FindClose(Entry);
  end;
end;

function IsVerifiedUpgradeDirectory(): Boolean;
begin
  Result := (VerifiedUpgradePath <> '') and
    SameText(VerifiedUpgradePath, NormalizeLocalDirectory(WizardDirValue())) and
    IsSafeInstallDirectory(VerifiedUpgradePath);
end;

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
  UninstallerDirectory: String;
  InstallDirectory: String;
  ExitCode: Integer;
begin
  Result := True;
  ExitCode := -1;
  if not QueryPreviousElectronUninstaller(CommandLine) then
    Exit;
  SplitUninstallCommand(CommandLine, Filename, Parameters);
  if (Filename = '') or (not FileExists(Filename)) then begin
    Log('Previous Electron uninstall entry is orphaned; no executable remains to retire, so installation will continue.');
    Result := True;
    Exit;
  end;
  UninstallerDirectory := NormalizeLocalDirectory(ExtractFileDir(Filename));
  InstallDirectory := NormalizeLocalDirectory(WizardDirValue());
  if (UninstallerDirectory = '') or (InstallDirectory = '') or
     DirectoryAtOrBelow(UninstallerDirectory, InstallDirectory) or
     DirectoryAtOrBelow(InstallDirectory, UninstallerDirectory) then begin
    Log('Previous Electron uninstall entry did not name a non-overlapping absolute application directory.');
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
var
  Directory: String;
  RegisteredDirectory: String;
  VerifiedUpgrade: Boolean;
begin
  Result := '';
  VerifiedUpgradePath := '';
  Directory := NormalizeLocalDirectory(WizardDirValue());
  if not IsSafeInstallDirectory(Directory) then begin
    Result := '安装目录不可用。请选择独立的本机目录，避开系统目录、知客数据目录和链接路径。';
    Exit;
  end;
  VerifiedUpgrade := False;
  if RegQueryStringValue(HKCU, CurrentNativeUninstallKey, 'Inno Setup: App Path', RegisteredDirectory) then
    VerifiedUpgrade := DirExists(Directory) and (CompareText(Directory, NormalizeLocalDirectory(RegisteredDirectory)) = 0);
  if not VerifiedUpgrade and not DirectoryIsEmpty(Directory) then begin
    Result := '安装目录中已有文件，且不是当前用户已登记的知客工作台目录。请选择空目录。';
    Exit;
  end;
  if VerifiedUpgrade then begin
    if not DirectoryTreeHasNoReparsePoints(Directory) then begin
      Result := '现有知客安装目录中含链接或无法读取的子目录。请备份业务数据后选择空目录重新安装。';
      Exit;
    end;
    VerifiedUpgradePath := Directory;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep <> ssPostInstall then Exit;
  if RetirePreviousElectronClient() then Exit;
  Log('The new Zhike installation is complete. The previous Electron client was retained; uninstall it separately if needed.');
  if not WizardSilent() then
    MsgBox('新版知客工作台已安装。旧版客户端未能自动卸载，可在 Windows“已安装的应用”中手动卸载“知客运营工作台”。旧版数据目录不会被读取、迁移或删除。', mbInformation, MB_OK);
end;

function IsInstalledWebView2Version(const VersionText: String): Boolean;
var
  I: Integer;
  DotCount: Integer;
  HasDigit: Boolean;
  Version: Int64;
begin
  Result := False;
  DotCount := 0;
  HasDigit := False;
  for I := 1 to Length(VersionText) do begin
    if VersionText[I] = '.' then begin
      if not HasDigit then Exit;
      DotCount := DotCount + 1;
      HasDigit := False;
    end else begin
      if (VersionText[I] < '0') or (VersionText[I] > '9') then Exit;
      HasDigit := True;
    end;
  end;
  if (DotCount <> 3) or not HasDigit then Exit;
  if not StrToVersion(VersionText, Version) then Exit;
  Result := Version > 0;
end;

function WebView2RuntimeRegistered(RootKey: Integer): Boolean;
var
  VersionText: String;
begin
  Result := False;
  if RegQueryStringValue(RootKey, WebView2ClientKey, 'pv', VersionText) then
    Result := IsInstalledWebView2Version(VersionText);
end;

function HasWebView2Runtime(): Boolean;
begin
  { Microsoft's Evergreen per-user key and x64 machine key in the 32-bit view. }
  Result := WebView2RuntimeRegistered(HKCU) or WebView2RuntimeRegistered(HKLM32);
end;

function InitializeSetup(): Boolean;
var
  Choice: Integer;
  ErrorCode: Integer;
begin
  Result := HasWebView2Runtime();
  if Result then
    Exit;

  Log('Microsoft Edge WebView2 Evergreen Runtime is required. Install it before rerunning Setup. Setup cancelled before changing files.');
  if WizardSilent() then
    Exit;

  Choice := MsgBox('未检测到 Microsoft Edge WebView2 Evergreen Runtime，知客安装已中止。请安装此运行时后重新运行安装程序。是否现在打开微软官方下载页？', mbConfirmation, MB_YESNO);
  if Choice = IDYES then
    ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
end;
