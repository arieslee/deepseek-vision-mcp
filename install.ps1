<#
.SYNOPSIS
  一键安装 deepseek-vision-mcp（Gemini 视觉 MCP server + vision skill）

.DESCRIPTION
  - 克隆/更新代码（GitHub: arieslee/deepseek-vision-mcp）
  - npm install + npm run build
  - 生成 .env 模板（已存在则跳过）
  - 输出 MCP 客户端注册配置、vision skill 安装命令、CLI 验证命令

.PARAMETER InstallDir
  安装目录（默认：脚本所在目录下的 deepseek-vision-mcp）

.PARAMETER RepoUrl
  仓库地址（默认 https://github.com/arieslee/deepseek-vision-mcp.git）

.PARAMETER SkipClone
  跳过克隆（目录已存在时用，例如只重新构建）

.PARAMETER SkipBuild
  跳过构建

.EXAMPLE
  ./install.ps1
  ./install.ps1 -InstallDir D:\tools\deepseek-vision-mcp
#>
param(
  [string]$InstallDir,
  [string]$RepoUrl = "https://github.com/arieslee/deepseek-vision-mcp.git",
  [switch]$SkipClone,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

# 默认安装目录：本地运行 = 脚本所在目录；远程执行（$PSScriptRoot 为空）= 当前目录
if (-not $InstallDir) {
  if ($PSScriptRoot) {
    $InstallDir = Join-Path $PSScriptRoot "deepseek-vision-mcp"
  } else {
    $InstallDir = Join-Path (Get-Location).Path "deepseek-vision-mcp"
  }
}

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Assert-Exit([string]$what) {
  if ($LASTEXITCODE -ne 0) { throw "$what 失败 (exit=$LASTEXITCODE)" }
}

# ---- 1. 获取代码 -----------------------------------------------------------
if (-not $SkipClone) {
  if (Test-Path $InstallDir) {
    Write-Step "目录已存在，更新代码: $InstallDir"
    Push-Location $InstallDir
    try { git pull --ff-only } finally { Pop-Location }
    Assert-Exit "git pull"
  } else {
    Write-Step "克隆仓库: $RepoUrl"
    git clone $RepoUrl $InstallDir
    Assert-Exit "git clone"
  }
} else {
  if (-not (Test-Path (Join-Path $InstallDir "package.json"))) {
    throw "SkipClone 模式下 $InstallDir 不是有效的项目目录（缺少 package.json）"
  }
}

# ---- 2. 依赖与构建 ----------------------------------------------------------
Write-Step "安装依赖 (npm install)"
Push-Location $InstallDir
try {
  npm install
  Assert-Exit "npm install"
  if (-not $SkipBuild) {
    Write-Step "构建 (npm run build)"
    npm run build
    Assert-Exit "npm run build"
  }
} finally { Pop-Location }

# ---- 3. .env 模板 -----------------------------------------------------------
$envFile = Join-Path $InstallDir ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $InstallDir ".env.example") $envFile
  Write-Step "已生成 .env 模板: $envFile（请打开填入 GEMINI_API_KEY）"
} else {
  Write-Step ".env 已存在，跳过: $envFile"
}

# ---- 4. 输出使用说明 ---------------------------------------------------------
$serverPath = Join-Path $InstallDir "dist\index.js"
$cliPath = Join-Path $InstallDir "scripts\analyze-image.mjs"

# 用 ConvertTo-Json 生成注册配置，反斜杠转义交给它处理
$mcpJson = [ordered]@{
  mcpServers = [ordered]@{
    "deepseek-vision-mcp" = [ordered]@{
      command = "node"
      args    = @($serverPath)
      env     = [ordered]@{ GEMINI_API_KEY = "你的_API_Key" }
    }
  }
} | ConvertTo-Json -Depth 5

Write-Host ""
Write-Host "==================== 安装完成 ====================" -ForegroundColor Green
Write-Host ""
Write-Host "1) MCP server: $serverPath"
Write-Host ""
Write-Host "2) MCP 客户端注册配置（Claude Desktop / Cursor 等）:" -ForegroundColor Yellow
Write-Host ""
Write-Host $mcpJson
Write-Host ""
Write-Host "3) 安装 vision skill（Reasonix 中执行）:" -ForegroundColor Yellow
Write-Host "   install_source source=https://github.com/arieslee/deepseek-vision-mcp"
Write-Host "   或 install_source source=https://raw.githubusercontent.com/arieslee/deepseek-vision-mcp/main/skills/vision/SKILL.md"
Write-Host ""
Write-Host "4) 命令行验证（配置 .env 后）:" -ForegroundColor Yellow
Write-Host "   node `"$cliPath`" `"<图片路径或URL>`" `"<可选指令>`""
Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
