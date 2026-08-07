#!/usr/bin/env node
/**
 * analyze-image.mjs — Gemini 视觉识别 CLI
 *
 * 通过 stdio MCP 协议调用 deepseek-vision-mcp 的 analyze_image 工具，
 * 因此与 MCP server 共享同一套能力（同一模型、同一图片来源支持）。
 *
 * 用法：
 *   node scripts/analyze-image.mjs <image> [prompt]
 *   node scripts/analyze-image.mjs <image> "定向问题" --max-tokens 2048
 *
 * <image> 支持：本地文件路径、http(s) 图片 URL、base64 data URI。
 *
 * 环境变量：
 *   GEMINI_API_KEY  必填，Gemini API Key
 *   GEMINI_MODEL    可选，默认 gemini-3.5-flash
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const serverPath = path.join(projectRoot, "dist", "index.js");
const CALL_TIMEOUT_MS = 180_000; // 图片上传+推理可能较慢

// ---- 加载 .env（cwd 优先，其次项目根；仅填充未设置的环境变量） ----------------
for (const dir of [process.cwd(), projectRoot]) {
  const envFile = path.join(dir, ".env");
  if (!existsSync(envFile)) continue;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      let value = m[2];
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (quoted) {
        value = value.slice(1, -1);
      } else {
        const hashIdx = value.indexOf(" #");
        if (hashIdx >= 0) value = value.slice(0, hashIdx).trimEnd();
      }
      process.env[m[1]] = value;
    }
  }
}

// ---- 参数解析 ------------------------------------------------------------
// 注意：必须跳过 "--max-tokens" 及其值，否则 "2048" 会被误当成 prompt
const args = process.argv.slice(2);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max-tokens") {
    i++; // 跳过其值
    continue;
  }
  if (args[i].startsWith("--")) continue;
  positional.push(args[i]);
}
const image = positional[0];
const prompt = positional[1];
const maxIdx = args.indexOf("--max-tokens");
const maxTokens = maxIdx >= 0 ? Number(args[maxIdx + 1]) : undefined;

if (!image) {
  console.error(
    [
      "用法: node scripts/analyze-image.mjs <image> [prompt] [--max-tokens N]",
      "  <image>: 本地文件路径 / http(s) URL / data:image/...;base64,xxxx",
      "示例: node scripts/analyze-image.mjs \"C:\\photos\\a.png\" \"图里有什么文字？逐字输出\"",
      "",
    ].join("\n")
  );
  process.exit(1);
}
if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192)) {
  console.error("[错误] --max-tokens 必须是 1-8192 的整数");
  process.exit(1);
}

// ---- 前置检查 ------------------------------------------------------------
const RAW_KEY = (process.env.GEMINI_API_KEY ?? "").trim();
const KEY_PLACEHOLDERS = [
  "your_api_key_here",
  "your_api_key",
  "your_key",
  "你的_api_key",
  "你的key",
];
if (!RAW_KEY || KEY_PLACEHOLDERS.includes(RAW_KEY.toLowerCase())) {
  console.error("[错误] 未配置有效的 GEMINI_API_KEY，无法调用 Gemini。");
  console.error('  PowerShell: $env:GEMINI_API_KEY = "你的_API_Key"');
  console.error("  或在项目 .env 中填入 GEMINI_API_KEY 后重新运行本命令。");
  process.exit(1);
}
if (!existsSync(serverPath)) {
  console.error(`[错误] 未找到构建产物 ${serverPath}`);
  console.error("  请在项目目录先运行: npm run build");
  process.exit(1);
}

// ---- stdio MCP 客户端 ------------------------------------------------------
const child = spawn(process.execPath, [serverPath], {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const pending = new Map();
let nextId = 0;

child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
// 透传 server 的 stderr 日志（如未配置 Key 的警告）
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("error", (e) => {
  console.error("[错误] 无法启动 MCP server:", e.message);
  process.exit(1);
});

function send(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`等待响应超时: ${method}`));
      }
    }, CALL_TIMEOUT_MS);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

try {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "gemini-vision-cli", version: "0.1.0" },
  });
  // JSON-RPC 通知：不带 id、不等待响应
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n"
  );

  const arguments_ = { image };
  if (prompt) arguments_.prompt = prompt;
  if (maxTokens !== undefined) arguments_.maxTokens = maxTokens;

  const res = await send("tools/call", {
    name: "analyze_image",
    arguments: arguments_,
  });

  const r = res.result ?? {};
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) {
    console.error(text);
    process.exitCode = 1;
  } else {
    console.log(text);
  }
} catch (e) {
  console.error("[错误]", e.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
