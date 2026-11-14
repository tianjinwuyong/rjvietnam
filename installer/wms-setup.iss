; ============================================================
;  WMS 仓库管理系统 1.0 —— 一键部署安装包
;  编译：ISCC.exe installer\wms-setup.iss
;  载荷：..\build\payload（由 installer\build.cjs 生成）
; ============================================================

#define AppName "WMS 仓库管理系统"
#define AppVersion "1.0"
#define AppPublisher "深圳市瑞晶实业有限公司"
#define AppServiceApp "WMS-App"

[Setup]
AppId={{8E3C2F61-7B4A-4C2E-9D31-5A7E1C0B9F42}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName=C:\WMS
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
OutputDir=..\build\out
OutputBaseFilename=WMS-Setup-1.0
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; 安装目录必须 ASCII：PostgreSQL 的 initdb 不支持中文路径
SetupLogging=yes
UninstallDisplayName={#AppName}
DisableReadyMemo=no

[Languages]
Name: "chs"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："

[Dirs]
Name: "{app}\logs"
Name: "{app}\ssl"

[Files]
; 全部载荷（dist / node / node_modules / pgsql / scripts / package.json / 文档）
Source: "..\build\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "pgdata\*,logs\*,.env,ssl\*,install-info.txt"

[Icons]
Name: "{group}\WMS 仓库管理系统"; Filename: "http://127.0.0.1:3000"
Name: "{group}\部署说明"; Filename: "{app}\README-DEPLOY.txt"
Name: "{group}\启动服务"; Filename: "{app}\scripts\start-wms.cmd"; WorkingDir: "{app}\scripts"
Name: "{group}\停止服务"; Filename: "{app}\scripts\stop-wms.cmd"; WorkingDir: "{app}\scripts"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\WMS 仓库管理系统"; Filename: "http://127.0.0.1:3000"; Tasks: desktopicon

[Run]
; 文件复制完成后执行环境自举：建库、建表、注册服务、启动、放行防火墙
Filename: "{app}\node\node.exe"; Parameters: """{app}\scripts\setup.cjs"""; WorkingDir: "{app}"; StatusMsg: "正在配置数据库与服务（约 1-3 分钟），请勿关闭窗口..."; Flags: waituntilterminated
Filename: "{app}\README-DEPLOY.txt"; Description: "查看部署说明"; Flags: postinstall shellexec nowait

[UninstallRun]
Filename: "{app}\node\node.exe"; Parameters: """{app}\scripts\uninstall.cjs"""; WorkingDir: "{app}"; RunOnceId: "WMSRemoveServices"; Flags: runhidden waituntilterminated

[UninstallDelete]
; 安装过程中生成的文件（不在 [Files] 清单里）
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\ssl"
Type: files; Name: "{app}\.env"
Type: files; Name: "{app}\install-info.txt"

[Code]
var
  StopCode: Integer;

procedure StopRunningServices();
begin
  // 升级安装时先把旧服务和占用文件的进程停掉，否则覆盖 dist 会失败
  Exec('net', 'stop {#AppServiceApp}', '', SW_HIDE, ewWaitUntilTerminated, StopCode);
  Exec('net', 'stop WMS-PostgreSQL', '', SW_HIDE, ewWaitUntilTerminated, StopCode);
  Sleep(2000);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunningServices();
  Result := '';
end;

function InitializeUninstall(): Boolean;
var
  KillCode: Integer;
begin
  Exec('net', 'stop {#AppServiceApp}', '', SW_HIDE, ewWaitUntilTerminated, KillCode);
  Exec('net', 'stop WMS-PostgreSQL', '', SW_HIDE, ewWaitUntilTerminated, KillCode);
  Sleep(2000);
  Result := True;
end;
