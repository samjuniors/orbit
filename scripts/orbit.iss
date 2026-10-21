; Inno Setup Script for ORBIT
; Compiles dist/orbit.exe and docs into a traditional Windows setup wizard.

#ifndef AppVersion
  #error AppVersion must be supplied by scripts/build-installer.js
#endif

[Setup]
AppId={{94B8BC9A-6E43-4E84-9D22-C84177F8329E}
AppName=ORBIT
AppVersion={#AppVersion}
AppVerName=ORBIT {#AppVersion}
AppPublisher=Samjuniors
AppPublisherURL=https://github.com/samjuniors/orbit
AppSupportURL=https://github.com/samjuniors/orbit/issues
AppUpdatesURL=https://github.com/samjuniors/orbit/releases
DefaultDirName={autopf}\Orbit
DefaultGroupName=ORBIT
DisableProgramGroupPage=yes
SourceDir=..
LicenseFile=LICENSE
OutputDir=dist
OutputBaseFilename=Orbit-Setup-{#AppVersion}
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "envPath"; Description: "Add ORBIT to PATH (recommended so 'orbit' works anywhere)"; GroupDescription: "System integration:"; Flags: checkedonce
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "dist\orbit.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.tmp"

[Icons]
Name: "{group}\ORBIT CLI"; Filename: "cmd.exe"; Parameters: "/k ""{app}\orbit.exe"" --help"; WorkingDir: "{userdocs}"
Name: "{group}\ORBIT Guided Setup"; Filename: "cmd.exe"; Parameters: "/k ""{app}\orbit.exe"" setup"; WorkingDir: "{userdocs}"
Name: "{group}\ORBIT Doctor"; Filename: "cmd.exe"; Parameters: "/k ""{app}\orbit.exe"" doctor"; WorkingDir: "{userdocs}"
Name: "{group}\ORBIT Documentation"; Filename: "https://github.com/samjuniors/orbit#readme"
Name: "{group}\Uninstall ORBIT"; Filename: "{uninstallexe}"
Name: "{autodesktop}\ORBIT"; Filename: "cmd.exe"; Parameters: "/k ""{app}\orbit.exe"" --help"; WorkingDir: "{userdocs}"; Tasks: desktopicon

[Run]
Filename: "cmd.exe"; Parameters: "/k ""{app}\orbit.exe"" setup"; Description: "Launch ORBIT Guided Setup now"; Flags: postinstall nowait skipifsilent unchecked

[Code]
const
  UserEnvKey = 'Environment';
  SystemEnvKey = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment';

function GetEnvRoot(): Integer;
begin
  if IsAdminInstallMode then
    Result := HKEY_LOCAL_MACHINE
  else
    Result := HKEY_CURRENT_USER;
end;

function GetEnvSubKey(): string;
begin
  if IsAdminInstallMode then
    Result := SystemEnvKey
  else
    Result := UserEnvKey;
end;

procedure EnvAddPath(PathToAdd: string);
var
  Paths: string;
begin
  if not RegQueryStringValue(GetEnvRoot(), GetEnvSubKey(), 'Path', Paths) then
    Paths := '';

  if Pos(';' + Uppercase(PathToAdd) + ';', ';' + Uppercase(Paths) + ';') = 0 then
  begin
    if (Paths <> '') and (Paths[Length(Paths)] <> ';') then
      Paths := Paths + ';';
    Paths := Paths + PathToAdd;
    RegWriteStringValue(GetEnvRoot(), GetEnvSubKey(), 'Path', Paths);
  end;
end;

procedure EnvRemovePath(PathToRemove: string);
var
  Paths: string;
  P: Integer;
begin
  if RegQueryStringValue(GetEnvRoot(), GetEnvSubKey(), 'Path', Paths) then
  begin
    P := Pos(';' + Uppercase(PathToRemove) + ';', ';' + Uppercase(Paths) + ';');
    if P > 0 then
    begin
      Delete(Paths, P - 1, Length(PathToRemove) + 1);
      RegWriteStringValue(GetEnvRoot(), GetEnvSubKey(), 'Path', Paths);
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('envPath') then
  begin
    EnvAddPath(ExpandConstant('{app}'));
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    EnvRemovePath(ExpandConstant('{app}'));
  end;
end;
