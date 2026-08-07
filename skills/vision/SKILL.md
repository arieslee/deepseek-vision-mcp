---
name: vision
description: 识别/分析图片（调用 deepseek-vision-mcp，默认 gemini-3.5-flash）。当用户要求识别、分析、查看、OCR 图片时使用。
---

# Vision — 图片识别 / 分析

识别、分析、查看图片内容时统一走 deepseek-vision-mcp 封装好的 CLI（底层通过 stdio MCP 协议调用其 `analyze_image` 工具，模型默认 `gemini-3.5-flash`）。

## 0. 定位 deepseek-vision-mcp 项目目录（按顺序，不要跳过）

1. 若环境变量 `VISION_MCP_DIR` 已设置 → 它就是项目目录。
2. 若当前工作目录或其任一父目录下存在 `scripts/analyze-image.mjs` → 该目录即项目根。
3. 若本 SKILL.md 的路径形如 `<项目根>\skills\vision\SKILL.md`（skill 安装在项目内）→ 向上两级即为项目根。
4. 在常见位置（用户主目录、工具目录等）快速查找 `analyze-image.mjs`（它位于项目根的 `scripts/` 下）；仍找不到就询问用户项目目录在哪，不要自行猜测路径。

令 `$MCP` = 找到的项目目录。

## 前提

- 需要 `GEMINI_API_KEY`：CLI 会自动加载项目 `.env`（`$MCP\.env`），也可来自环境变量。两者都没有时，提示用户配置（写入 `$MCP\.env` 一行 `GEMINI_API_KEY=你的Key`），不要编造。
- 若 `$MCP\dist\index.js` 不存在，先在 `$MCP` 目录运行 `npm run build`。

## 标准流程

1. 确认图片来源（让用户提供或从对话中提取）：
   - 本地文件：推荐绝对路径，如 `C:\photos\a.png`
   - 网络图片：完整 URL，如 `https://example.com/a.jpg`
   - base64：`data:image/png;base64,xxxx`
2. 运行命令：

   ```powershell
   node "$MCP\scripts\analyze-image.mjs" "<图片路径或URL>" "<可选的识别指令>"
   ```

   常见用法：
   - 默认描述：`node "$MCP\scripts\analyze-image.mjs" "C:\photos\a.png"`
   - 定向问题：`node "$MCP\scripts\analyze-image.mjs" "C:\photos\a.png" "图里有哪些文字？逐字输出"`
   - 提取代码（OCR）：`node "$MCP\scripts\analyze-image.mjs" "C:\photos\code.png" "把图片中的代码逐字完整识别出来，保留缩进、空格和标点，不要改写或省略" --max-tokens 8192`
   - 限制长度：`node "$MCP\scripts\analyze-image.mjs" "C:\photos\a.png" "用一句话总结" --max-tokens 256`
3. 把模型输出作为识别结果按原样呈现给用户，不要加工杜撰。
4. 若输出以 `[错误]` 开头：向用户转述错误并给出修复建议（常见：未配置 `GEMINI_API_KEY`、未执行 `npm run build`、图片路径不存在、网络问题；若报模型不存在，提示用户在 `$MCP\.env` 中改 `GEMINI_MODEL`）。

## 规则

- 用户说"识别/分析/看这张图片"但没给路径时，先向用户确认图片位置，不要猜测。
- 识别结果一律以模型输出为准，禁止自己凭空描述图片内容。
- 模型是视觉模型，只处理图片；不要用它做与图片无关的任务。
- 不要泄露或硬编码任何 API Key。
