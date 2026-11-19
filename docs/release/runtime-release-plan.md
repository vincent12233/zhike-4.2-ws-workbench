# 知客 Windows 本机版候选发布计划

## 当前 rc.3 交付与后续构建

`v6.1.0-rc.3` 已发布，安装包对应源码 `bddb8ae33604110cdd191d7b7589fc8fe9d692bf`。下载资产与校验值见[当前版本索引](../current-release-index.md)；独立扫码采集的操作和验证范围见[独立采集说明](independent-collector-followup.md)。生产 Worker、自动 AI 和旧认证 profile 复制仍关闭，独立采集使用用户另行扫码的会话。

- 当前构建入口为 `.github/workflows/windows-validation.yml`，在 Windows 2025 runner 上编译、回归、自包含打包并执行首次安装、同候选覆盖安装和卸载检查。它只上传 CI 产物，不自动替换已发布安装包。
- rc.3 的[构建验证记录](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44510928815)和[发布记录](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44512599386)均已通过。合成安装检查不代表真实 WhatsApp 或用户数据跨候选升级验收。
- `.github/workflows/publish-rc3.yml` 和 `scripts/publish-verified-rc3.py` 是绑定该次构建、标签、草稿 ID 和资产哈希的专用交付记录，不能作为下一个版本的通用发布器。下次候选需选择新标签、完成相应构建和校验，再使用明确的发布参数；不得移动 rc.3 标签或覆盖它的资产。
- 手动构建继续使用下文的 bundle/installer `-ReleaseGate` 命令与全新 `work/` 输出目录。下文 rc.1 的快照推送与标签命令仅保留作历史记录，不是当前主分支操作步骤。后续源码通过 PR 检查后合并。

## rc.1 历史发布计划（保留记录）

以下内容描述 rc.1 当时的环境和发布安排，不表示 rc.3 的功能、构建或发布状态。

2026-11-19。分支 `integration/61-runtime-release`，审计基线 `54d33f6`。当前候选版本为 `6.1.0`，预发行标签为 `v6.1.0-rc.1`。本次用户已授权构建安装包并将仓库和候选发布交付到现有 GitHub 仓库。采用预发行标记，保留已知阻断和所有历史发布。仓库沿用现有私有可见性，生产 Worker、自动 AI 消费者及 RD02 后台采集继续关闭。

## 用户从哪里开始

1. 从 GitHub 的 **预发行版本** 下载本次安装器和对应清单。运行前，在 PowerShell 用 `Get-FileHash -LiteralPath <安装包路径> -Algorithm SHA256` 核对清单。若清单显示未签名，Windows 可能提示未知发布者；请保留系统安全保护。哈希用于核对文件字节和发布记录。
2. 此候选面向 Windows x64，安装器要求内部版本 22621 或以上。请在运行知客安装器前安装 Microsoft Edge WebView2 Evergreen Runtime。桌面包自包含 .NET、Windows App SDK 和 Node SQLite。干净的受支持 Windows、覆盖升级和卸载仍待独立实机验证。
3. 安装器以当前用户安装，默认目录为 `%LOCALAPPDATA%\Programs\ZhikeNative`，从桌面或开始菜单的“知客工作台”打开。首次使用知客 6 系列数据目录时会创建空库 `%LOCALAPPDATA%\Zhike6\workspace.sqlite`。安装检测到旧 Electron 客户端时可调用其卸载程序，因此迁移前先在旧应用中导出和备份。现有安装脚本保留外置新旧数据目录，无旧库自动迁移。
4. 在“客户中心”“快捷录入”或相应业务页面开始录入。客户、业务资料、导入、统计以及数据中心的本机备份可离线使用。换机或覆盖安装前先导出备份。出现启动错误时先关掉旧窗口，确认本机数据目录可写并保留界面错误，勿删除 SQLite 或正在使用的锁文件。
5. WS 工作台的前台聊天需要联网，操作员在官方页面自己登录，可在经验证的账号环境内使用前台聊天和手动导入。联系人、群组、审计与历史记录来自本机已保存资料。自动发现、后台采集、自动完整历史和后台群组监测保持关闭，真实头像来源尚无授权可用接入。GPT 运营助手可查看本机已保存资料，显式生成或翻译需要用户配置并验证相应联网服务。确认发送前核对所选数据和服务方，外部服务的真实请求和付费质量尚未验收。

## 构建与安装审计

| 项目 | 查证结果 |
|---|---|
| 版本与目标 | 桌面项目、sidecar、包定义和 Inno 安装器使用 `6.1.0`，页面标题使用 `6.1`。程序集目标为 `net10.0-windows10.0.22621.0`，安装器声明 `x64compatible` 和 `MinVersion=10.0.22621`。这核对了候选安装器最低门槛，干净机实测另行记录。 |
| 开发机依赖 | 仓库运行时为 Node `v24.22.1` x64，`node:sqlite` 可加载。.NET 10 SDK 为本机准备的 `10.0.100`，Inno Setup `7.1.1` 的 `ISCC.exe` 在脚本可发现的位置。项目使用 Windows App SDK `2.6.4` 和 WebView2 SDK `1.0.3719.77`。未运行构建或安装。 |
| 签名与历史文件 | 本机未配置脚本签名证书。已有安装器经 SHA-256 核对与 2026-11-15 清单一致，Authenticode 为 `NotSigned`，仅代表该历史文件。候选必须重新构建并实测签名状态。 |
| 安装文件 | bundle 复制明示应用资源，阻止典型数据库、日志和凭据名，installer 检查阶段清单全文件哈希并递归打包完整阶段目录。assets/modules/migrations 为目录范围，仍需检查其中新增文件和链接。当前候选需确认 `resources/app/node.exe`、XBF、WebView2Loader、迁移和 CSS/SVG 等均在实际产物，且无缓存、备份、profile、`connection.private.json`、历史安装器或数据。 |
| 源码包 | 源码 ZIP 排除明确的旧运行入口和历史验收证据目录。Git 仍完整保留证据、说明和历史清单。需要查阅报告引用的原始证据时，使用正常 Git clone 并按对应提交查看。基线中 `docs/release/evidence` 有 1,391 个文件，原始约 81.5 MiB。它们不会由默认安装器从 Git 树带入。本机 Git archive 预检由 58,396,710 字节降至 17,551,588 字节。过滤后 0 个历史证据目录条目，保留当前索引和历史报告。最终构建的源码 ZIP 仍须检查实际内容与 100 MiB 上限。 |

## 发布顺序

1. **冻结本地来源。** 在 `integration/61-runtime-release` 完成最终全量回归，记录通过数、失败原因与来源提交。保留本地完整历史、历史报告和现有 6.0.3 安装文件。`18b0d25` 只在新源码树中停止跟踪旧安装器，文件保留在原机器上。只读 Git LFS 核对显示远端缺少 40 个历史安装器对象，共 4,562,680,854 字节。本次发布只提交候选源码快照。
2. **固定快照。** 读取当时的 `origin/main`。从已记录回归结果的本地来源树创建一个只有该远端主分支提交作为父提交的候选源码提交，在提交说明和发布记录中保留本地完整来源 SHA、远端父提交与快照 SHA。先比对两个源码树一致，并确认快照下无安装 EXE、无非空待传 LFS 对象。Git LFS 3.8.1 的 dry-run 可能列出旧证据里的零字节输出，保留该日志并按零字节对象核对。
3. **从快照构建。** 使用独立干净的快照工作树，先核对 `git status --porcelain`，将 bundle 和 installer 写到各自全新的 `work/` 子目录。校验阶段清单、EXE 版本、文件大小、SHA-256 和 Authenticode。安装清单的 `sourceCommit` 必须是快照提交。需要烟测时，使用经确认隔离的 Windows 账号或 VM。常规产品按当前账号的 LocalAppData 计算数据目录，普通临时路径参数无法隔离。无法现场验证的项目继续标为未验收。
4. **正常快进与预发行。** 复核远端 `main` 仍为快照父提交后，用普通快进将该单一快照推到 `main`，保留 Git LFS 的标准钩子。若远端已变化或分支规则阻止，先重新审查基线。用同一快照 SHA 创建并推送唯一候选 tag `v6.1.0-rc.1`，然后创建 GitHub 预发行条目。安装器、同次清单及可选已核验运行 ZIP 只作为 Release 附件交付。
5. **记录验收。** 本地来源分支与远端发布快照的关系写入交付记录。S3 的物理输入、多 DPI、长期资源和干净目标机矩阵尚缺证据。审计基线的最后一轮全量为 317/319，S1 主界面和 WS 两项为独立 Edge 退出失败。本轮记录以实际执行为准。`-ReleaseGate` 校验干净源码、版本、清单和字节。S3、真实 WS、付费 AI 与目标机安装仍各自记录，生产默认边界保持。

```powershell
# PowerShell 7, from a clean worktree for the final snapshot commit.
$ErrorActionPreference = 'Stop'
$commit = (git rev-parse --verify HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Commit verification failed.' }
$dirty = @(git status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $dirty.Count) { throw 'Commit the complete candidate first.' }
$work = Join-Path (Get-Location) 'work'
if (!(Test-Path -LiteralPath $work)) { New-Item -ItemType Directory -Path $work | Out-Null }
$workItem = Get-Item -LiteralPath $work -Force
if (!$workItem.PSIsContainer -or ($workItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'A local work/ directory is required.' }
$releaseRoot = Join-Path $work ('release-6.1.0-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $releaseRoot | Out-Null
$bundle = Join-Path $releaseRoot 'bundle'
$installer = Join-Path $releaseRoot 'installer'
& ./scripts/build-winui-bundle.ps1 -Version 6.1.0 -Configuration Release -RuntimeIdentifier win-x64 -SelfContained -ReleaseGate -OutputDir $bundle
$stage = Join-Path $bundle 'zhike-winui-6.1.0-win-x64'
& ./scripts/build-winui-installer.ps1 -AppVersion 6.1.0 -ReleaseGate -StageDir $stage -OutputDir $installer

# Run only from the reviewed single-commit release snapshot.
$tag = 'v6.1.0-rc.1'
$parentInfo = (git rev-list --parents -n 1 $commit).Trim().Split(' ')
if ($LASTEXITCODE -ne 0 -or $parentInfo.Count -ne 2) { throw 'Expected one snapshot parent.' }
$remoteRef = (git ls-remote --exit-code origin refs/heads/main)
if ($LASTEXITCODE -ne 0) { throw 'Could not verify remote main.' }
$remoteMain = ($remoteRef -split '\s+')[0]
if ($parentInfo[1] -cne $remoteMain) { throw 'Remote main moved or the snapshot parent is wrong.' }
$lfsDryRun = @(git lfs push --dry-run origin HEAD)
if ($LASTEXITCODE -ne 0) { throw 'LFS dry-run failed.' }
if ($lfsDryRun | Where-Object { $_ -notmatch '^push\s+e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\s+=>' }) {
  throw 'The snapshot would transfer a nonempty LFS object or returned an unexpected LFS line.'
}
git push origin "${commit}:refs/heads/main"
if ($LASTEXITCODE -ne 0) { throw 'Fast-forward push failed.' }
git tag -a $tag $commit -m 'Zhike 6.1.0 A+B prerelease candidate'
if ($LASTEXITCODE -ne 0) { throw 'Candidate tag was not created.' }
git push origin "refs/tags/$tag"
if ($LASTEXITCODE -ne 0) { throw 'Tag push failed.' }
& ./scripts/publish-github-prerelease.ps1 -Commit $commit -ArtifactDirectory $installer -Tag $tag
# Only after reviewing the preflight.
& ./scripts/publish-github-prerelease.ps1 -Commit $commit -ArtifactDirectory $installer -Tag $tag -Publish
```

安装器脚本保留中文的本地输出文件名。GitHub 下载名使用 ASCII `zhike-6.1.0-win-x64-setup.exe`，避免资产服务重写非 ASCII 文件名。清单记录两种文件名、源码提交、签名状态与校验值。可通过 `-NotesPath` 选择当前 `work/` 下已审阅的本轮实测说明。

发布脚本默认只读检查本机清单、SHA-256、Authenticode、目标仓库权限、远端候选 tag 和历史 Release。显式 `-Publish` 创建草稿，上传安装器与清单，核对 GitHub 返回的资产大小和 SHA-256，再发布为预发行。失败时保留已有草稿供核查，不自动重试、覆盖或删除。发布和资产接口详见[GitHub Releases REST](https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28)与[资产 REST](https://docs.github.com/en/rest/releases/assets?apiVersion=2022-11-28)。

## 发布权限与仓库卫生

- `origin` 指向 `vincent12233/zhike-4.2-ws-workbench`。Git Credential Manager 已能非交互取得凭据。GitHub API 已认证只读返回私有仓库、默认 `main` 和 `permissions.push=true`。未打印凭据、推送分支、创建 tag 或上传资产。具体分支限制及 Release 写入以实际授权发布结果为准。
- 当前未找到 `gh`，常用 GitHub token 环境变量未设置。可以继续用已就绪的 Git 凭据推送源码，Release 可走已认证网页，或使用该只读预检和显式上传脚本。仓库保持私有，下载者需要已有仓库访问权限。
- `.tools/`、`work/`、数据库和 Node 安装件已忽略。`releases/*.exe` 自 `18b0d25` 起忽略。历史安装 EXE 继续留在本机，候选安装器及其清单只从 GitHub Release 分发。提交前仅检查预定文件和已暂存内容，无用户数据库、快照、认证 profile、私有连接、密钥、大型二进制或未脱敏证据。历史版本和本机用户数据不删除。
