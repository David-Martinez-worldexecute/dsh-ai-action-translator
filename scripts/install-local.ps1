<#
.SYNOPSIS
    把当前仓库的 dsh-ai-action-translator 同步到你本机的 DSH 插件目录。

.DESCRIPTION
    DSH 桌面版的插件是"从本地目录 link 进来"的：
        C:\Users\<你>\.dsh\profiles\desktop\package.json 里有一行
        "dsh-ai-action-translator": "link:C:/Users/<你>/.dsh/plugins/dsh-ai-action-translator"

    所以"安装新版本"= 把仓库里的新文件复制到 C:\Users\<你>\.dsh\plugins\dsh-ai-action-translator。
    这个脚本做四件事：
        1. 检查源目录（版本号、必需文件是否齐全）
        2. 把旧安装目录备份成 dsh-ai-action-translator.bak-<时间戳>
        3. 把新文件递归复制过去（跳过 .git 和 node_modules）
        4. 读回校验：版本号、stepParse 控件、JS 语法

    复制是"覆盖式"的，但备份一定先做；脚本最后会打印回滚命令。

    为什么不用 robocopy：在受限沙箱里，外部进程的 stdio 会被命名管道限制拦下
    （Access to the path '\\.\pipe\LOCAL\dotnet_...' is denied），
    而 Copy-Item 是纯 PowerShell，不经过那层管道。

.PARAMETER Source
    仓库根目录。默认是脚本上一级（也就是你 clone 下来的这个项目）。

.PARAMETER Target
    安装目录。默认 $HOME\.dsh\plugins\dsh-ai-action-translator。

.PARAMETER Profile
    DSH profile 目录（用来确认 link 依赖在不在）。默认 $HOME\.dsh\profiles\desktop。

.PARAMETER DryRun
    只打印"将要做什么"，一个文件都不复制、不备份。第一次跑建议先加它。

.EXAMPLE
    # 先看计划，不改任何东西
    pwsh -File scripts\install-local.ps1 -DryRun

.EXAMPLE
    # 真的装（会先自动备份）
    pwsh -File scripts\install-local.ps1
#>

[CmdletBinding()]
param(
    [string]$Source = (Split-Path -Parent $PSScriptRoot),
    [string]$Target = (Join-Path $HOME '.dsh\plugins\dsh-ai-action-translator'),
    [string]$Profile = (Join-Path $HOME '.dsh\profiles\desktop'),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Say($text) { Write-Host $text }
function Step($text) { Write-Host ""; Write-Host "== $text ==" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "   OK   $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   WARN $text" -ForegroundColor Yellow }
function Die($text)  { Write-Host "   FAIL $text" -ForegroundColor Red; exit 1 }

# 递归复制目录，可以排除指定名字的子目录（.git / node_modules）。
# 用 Copy-Item 而不是 robocopy：受限沙箱下外部进程的 stdio 会被拦。
function Copy-Tree {
    param(
        [string]$From,
        [string]$To,
        [string[]]$ExcludeDirs = @()
    )
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    Get-ChildItem $From -Force | ForEach-Object {
        if ($_.PSIsContainer) {
            if ($ExcludeDirs -contains $_.Name) { return }
            Copy-Tree -From $_.FullName -To (Join-Path $To $_.Name) -ExcludeDirs $ExcludeDirs
        } else {
            Copy-Item $_.FullName (Join-Path $To $_.Name) -Force
        }
    }
}

Step "0. 环境"
Say "   源目录 : $Source"
Say "   安装到 : $Target"
Say "   Profile: $Profile"
if ($DryRun) { Warn "DryRun 模式：只打印计划，不复制任何文件" }

# ── 1. 检查源 ───────────────────────────────────────────────
Step "1. 检查源目录"
$srcPkg = Join-Path $Source 'package.json'
if (-not (Test-Path $srcPkg)) { Die "找不到 $srcPkg ——这个脚本要放在仓库的 scripts\ 目录下跑" }

$srcMeta = Get-Content $srcPkg -Raw | ConvertFrom-Json
if ($srcMeta.name -ne 'dsh-ai-action-translator') { Die "源 package.json 的 name 是 '$($srcMeta.name)'，不是 dsh-ai-action-translator" }
Ok "包名 $($srcMeta.name)，版本 $($srcMeta.version)"

$required = @(
    'lib\index.js', 'lib\server.js', 'lib\presets.js', 'lib\page.js',
    'lib\store.js', 'lib\trust.js', 'client.js', 'cordis.patch.yml'
)
$missing = @()
foreach ($rel in $required) {
    if (-not (Test-Path (Join-Path $Source $rel))) { $missing += $rel }
}
if ($missing.Count -gt 0) { Die ("源目录缺文件：" + ($missing -join ', ')) }
Ok "必需文件 $($required.Count) 个都在"

# stepParse 是这一版的重点能力，缺了说明你跑的不是同一个仓库
$pageSrc = Get-Content (Join-Path $Source 'lib\page.js') -Raw
if ($pageSrc -notmatch 'id="stepParse"') { Die "源 lib\page.js 里没有 stepParse 控件——这不像 0.5.0" }
Ok "源 lib\page.js 含 stepParse 控件"

$clientSrc = Get-Content (Join-Path $Source 'client.js') -Raw
if ($clientSrc -notmatch "'stepParse'") { Die "源 client.js 里没有 stepParse 字段" }
Ok "源 client.js 含 stepParse 字段"

# ── 2. 检查目标 ─────────────────────────────────────────────
Step "2. 检查安装目录"
$targetExists = Test-Path $Target
if ($targetExists) {
    $oldMeta = $null
    $oldPkg = Join-Path $Target 'package.json'
    if (Test-Path $oldPkg) { $oldMeta = Get-Content $oldPkg -Raw | ConvertFrom-Json }
    if ($oldMeta) { Ok "现有安装版本 $($oldMeta.version)（将被覆盖，先备份）" }
    else          { Warn "现有目录没有可读的 package.json，仍然会先备份再覆盖" }
} else {
    Warn "安装目录不存在，将新建：$Target"
}

$profilePkg = Join-Path $Profile 'package.json'
$linkLine = $null
if (Test-Path $profilePkg) {
    $linkLine = Select-String -Path $profilePkg -Pattern 'dsh-ai-action-translator' -SimpleMatch | Select-Object -First 1
}
if ($linkLine) {
    Ok "profile 里已经有 link 依赖（第 $($linkLine.LineNumber) 行）"
} else {
    Warn "profile 的 package.json 里没找到 dsh-ai-action-translator，装上也不会被加载"
    Warn "请在该文件里加一行：`"dsh-ai-action-translator`": `"link:$($Target -replace '\\','/')`""
}

if ($DryRun) {
    Step "DryRun 结束"
    Say "   真正执行时会发生：备份 -> 递归复制（跳过 .git / node_modules）-> 读回校验"
    Say "   去掉 -DryRun 再跑一次就会真的装。"
    exit 0
}

# ── 3. 备份 ─────────────────────────────────────────────────
Step "3. 备份旧安装"
$backup = $null
if ($targetExists) {
    $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$Target.bak-$stamp"
    Copy-Tree -From $Target -To $backup -ExcludeDirs @('node_modules', '.git')
    Ok "已备份到 $backup（未含 node_modules / .git）"
} else {
    Warn "没有旧目录，跳过备份（回滚就是删掉新目录）"
}

# ── 4. 同步 ─────────────────────────────────────────────────
Step "4. 同步新文件"
Copy-Tree -From $Source -To $Target -ExcludeDirs @('.git', 'node_modules', 'preview')
Ok "同步完成（已跳过 .git / node_modules）"

# ── 5. 读回校验 ─────────────────────────────────────────────
Step "5. 读回校验"
$newPkg = Join-Path $Target 'package.json'
if (-not (Test-Path $newPkg)) { Die "同步后目标里没有 package.json" }
$newMeta = Get-Content $newPkg -Raw | ConvertFrom-Json
if ($newMeta.version -ne $srcMeta.version) { Die "目标版本 $($newMeta.version) 与源 $($srcMeta.version) 不一致" }
Ok "版本号一致：$($newMeta.version)"

$pageDst = Get-Content (Join-Path $Target 'lib\page.js') -Raw
if ($pageDst -notmatch 'id="stepParse"') { Die "目标 lib\page.js 没有 stepParse 控件" }
Ok "目标 lib\page.js 有 stepParse 控件"

$clientDst = Get-Content (Join-Path $Target 'client.js') -Raw
if ($clientDst -notmatch "'stepParse'") { Die "目标 client.js 没有 stepParse 字段" }
Ok "目标 client.js 有 stepParse 字段"

$patchDst = Get-Content (Join-Path $Target 'cordis.patch.yml') -Raw
if ($patchDst -notmatch 'stepParse:\s*true') { Die "目标 cordis.patch.yml 没有 stepParse: true" }
Ok "目标 cordis.patch.yml 有 stepParse: true"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $syntaxOk = $true
    foreach ($rel in @('lib\index.js', 'lib\server.js', 'lib\presets.js', 'lib\page.js', 'client.js')) {
        & node --check (Join-Path $Target $rel)
        if ($LASTEXITCODE -ne 0) { $syntaxOk = $false; Warn "语法检查失败：$rel" }
    }
    if ($syntaxOk) { Ok "5 个源文件语法检查通过" }
} else {
    Warn "这台机器上没找到 node，跳过语法检查（不影响安装，但建议装一个 Node 20+）"
}

# ── 6. 收尾 ─────────────────────────────────────────────────
Step "6. 完成"
Say "   安装位置 : $Target"
Say "   下一步   : 重启 DSH 桌面版（插件在启动时加载，热更不可靠）"
Say "   然后     : 设置 -> 插件 -> AI 动作翻译器，就能看到「一步一步解析」开关"
if ($backup) {
    Say "   回滚     : Remove-Item '$Target' -Recurse -Force; Rename-Item '$backup' 'dsh-ai-action-translator'"
} else {
    Say "   回滚     : Remove-Item '$Target' -Recurse -Force"
}
