# gemini-vision-mcp

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

## 从 GitHub 安装（分发到其他机器 / 项目）

### 1. 获取代码

```bash
git clone https://github.com/arieslee/deepseek-vision-mcp.git
cd gemini-vision-mcp
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

装好后即可在 Reasonix 中说「识别这张图片」使用。skill 会按 `VISION_MCP_DIR` 环境变量 → 默认路径 → 查找 `analyze-image.mjs` 的顺序定位项目目录，找不到时向你询问。

## 在 MCP 客户端中配置

### Claude Desktop

编辑 `claude_desktop_config.json`（Windows 位于 `%APPDATA%\Claude\claude_desktop_config.json`），添加：

```json
{
  "mcpServers": {
    "gemini-vision": {
      "command": "node",
      "args": ["C:\\path\\to\\gemini-vision-mcp\\dist\\index.js"],
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
