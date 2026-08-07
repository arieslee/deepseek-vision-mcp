# deepseek-vision-mcp

一个基于 TypeScript 的 [MCP](https://modelcontextprotocol.io)（Model Context Protocol）服务器，封装 Gemini 视觉模型，用于图片分析。默认模型 `gemini-3.5-flash`，可通过环境变量覆盖。

## 功能

- 暴露 `analyze_image` 工具，调用 Gemini 视觉模型返回文本结果
- 图片来源支持三种：
  - 本地文件路径（如 `C:\photos\a.png`、`./a.jpg`）
  - http(s) 图片 URL（自动下载）
  - base64 data URI（`data:image/png;base64,xxxx`）
- 模型名、API Key、端点全部通过环境变量配置，代码中不硬编码任何密钥

## 环境变量（配置你的 API Key）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `GEMINI_API_KEY` | ✅ 必填 | 你的 Gemini API Key，从 <https://aistudio.google.com/apikey> 获取 |
| `GEMINI_MODEL` | 可选 | 模型 ID，默认 `gemini-3.5-flash` |
| `GEMINI_API_BASE` | 可选 | API 端点，默认 `https://generativelanguage.googleapis.com/v1beta` |

## 安装与构建

```bash
npm install
npm run build   # 产物在 dist/index.js
```

## 一键脚本安装（Windows，推荐）

仓库根目录自带 `install.ps1`，一条命令完成：克隆/更新代码 → `npm install` → `npm run build` → 生成 `.env` 模板 → 打印 MCP 注册配置与 skill 安装命令。

**一条命令（PowerShell 5.1+，推荐）**：

```powershell
irm 'https://raw.githubusercontent.com/arieslee/deepseek-vision-mcp/main/install.ps1' | iex
```

> 注意：这会在**当前目录**下创建 `deepseek-vision-mcp` 文件夹并安装。执行远程脚本前请确认来源可信（内容可在 GitHub 上审阅）。

需要自定义参数（如指定安装目录）时，下载到本地运行：

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/arieslee/deepseek-vision-mcp/main/install.ps1" -OutFile install.ps1
./install.ps1 -InstallDir D:\tools\deepseek-vision-mcp
```

常用参数：

```powershell
./install.ps1 -InstallDir D:\tools\deepseek-vision-mcp   # 指定安装目录
./install.ps1 -SkipClone                                  # 目录已存在，只重新构建
```

## npm 安装（npx 即用，最方便）

> **命名说明**：GitHub 仓库名为 `deepseek-vision-mcp`，但 npm 上该名字已被他人占用（另一个视觉 MCP server），因此 **npm 发布名使用 `gemini-vision-mcp`**——同一个项目，两个名字各管一摊：GitHub = 源码仓库，npm = 包分发。

```bash
# 全局安装
npm install -g gemini-vision-mcp
```

MCP 客户端配置（无需 clone，`npx` 直接运行，env 注入 Key；或在你工作目录放一个 `.env` 写入 `GEMINI_API_KEY=你的Key`，server 会自动读取 cwd 下的 `.env`）：

```json
{
  "mcpServers": {
    "gemini-vision-mcp": {
      "command": "npx",
      "args": ["-y", "gemini-vision-mcp"],
      "env": { "GEMINI_API_KEY": "你的_API_Key" }
    }
  }
}
```

> 状态：`gemini-vision-mcp@0.1.0` 目前**尚未发布到 npm**（需要拥有 npm 账号的人执行一次 `npm publish`）。发布后以上配置即可直接使用。

## 从 GitHub 安装（手动方式，分发到其他机器 / 项目）

### 1. 获取代码

```bash
git clone https://github.com/arieslee/deepseek-vision-mcp.git
cd deepseek-vision-mcp
npm install
npm run build
```

### 2. 配置 API Key

复制 `.env.example` 为 `.env`，填入你的 Key（`.env` 已被 git 忽略，不会误提交）：

```
GEMINI_API_KEY=你的_API_Key
```

### 3. 注册 MCP server 到客户端

参考上文「在 MCP 客户端中配置」，`command: node`，`args: [<克隆路径>\dist\index.js]`。

### 4. 安装 vision skill（Reasonix）

仓库内自带 `skills/vision/SKILL.md`，两种安装方式任选：

- 从仓库根安装（自动识别 skill）：
  ```
  install_source source=https://github.com/arieslee/deepseek-vision-mcp
  ```
- 或直接安装 raw 文件：
  ```
  install_source source=https://raw.githubusercontent.com/arieslee/deepseek-vision-mcp/main/skills/vision/SKILL.md
  ```

装好后即可在 Reasonix 中说「识别这张图片」使用。skill 定位项目目录的顺序：`VISION_MCP_DIR` 环境变量 → 当前目录/父目录含 `scripts/analyze-image.mjs` → skill 自身位置向上推断 → 常见位置查找 → 询问用户。

## 在 MCP 客户端中配置

### Claude Desktop

编辑 `claude_desktop_config.json`（Windows 位于 `%APPDATA%\Claude\claude_desktop_config.json`），添加：

```json
{
  "mcpServers": {
    "gemini-vision": {
      "command": "node",
      "args": ["C:\\path\\to\\deepseek-vision-mcp\\dist\\index.js"],
      "env": {
        "GEMINI_API_KEY": "你的_API_Key",
        "GEMINI_MODEL": "gemini-3.5-flash"
      }
    }
  }
}
```

> 路径请换成你实际的 `dist/index.js` 绝对路径；Windows 下反斜杠需写成 `\\`。

### Cursor / 其他支持 stdio MCP 的客户端

在客户端的 MCP 配置里注册同样的 server，env 中带上 `GEMINI_API_KEY` 即可。

### 命令行直接运行（调试）

PowerShell：

```powershell
$env:GEMINI_API_KEY = "你的_API_Key"
$env:GEMINI_MODEL = "gemini-3.5-flash"
node dist/index.js
```

## 工具说明

### `analyze_image`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `image` | string | ✅ | 本地文件路径 / http(s) URL / base64 data URI |
| `prompt` | string | 否 | 分析指令，默认「请详细描述这张图片的内容」 |
| `maxTokens` | number | 否 | 最大输出 token 数，默认 1024，最大 8192 |

返回值：模型的文本回答；出错时返回 `isError: true` 并附错误信息。

## 作为 vision skill 使用

本项目已封装为 `vision` skill（识别图片统一入口）。在 Reasonix 中直接说「识别这张图片」并给出图片位置即可，agent 会自动调用：

```powershell
# 等价于手动运行（底层通过 stdio MCP 协议调用上面的 analyze_image 工具）
node scripts\analyze-image.mjs "<图片路径或URL>" "<可选的识别指令>"
```

- 图片来源同样支持本地路径 / http(s) URL / base64 data URI
- 仍需先配置 `GEMINI_API_KEY`（同上文环境变量）

## 开发命令

```bash
npm run dev    # tsx 直接运行源码（开发）
npm test       # 端到端冒烟测试（不调用真实 API，验证握手 / 工具注册 / 无 Key 错误路径）
```
