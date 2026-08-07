import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// 配置（全部通过环境变量，绝不硬编码密钥）
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 加载 .env（cwd 优先，其次项目根；仅填充未设置的环境变量）便于用户"配置一次长期生效" */
function loadDotEnv(): void {
  const candidates = [process.cwd(), PROJECT_ROOT];
  for (const dir of candidates) {
    const envFile = path.join(dir, ".env");
    if (!existsSync(envFile)) continue;
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || process.env[m[1]] !== undefined) continue;
      let value = m[2];
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (quoted) {
        value = value.slice(1, -1);
      } else {
        // 未加引号的值支持行尾注释（以 " #" 分隔）
        const hashIdx = value.indexOf(" #");
        if (hashIdx >= 0) value = value.slice(0, hashIdx).trimEnd();
      }
      process.env[m[1]] = value;
    }
  }
}
loadDotEnv();

const API_KEY = process.env.GEMINI_API_KEY ?? "";

const KEY_PLACEHOLDERS = new Set([
  "your_api_key_here",
  "your_api_key",
  "your_key",
  "你的_api_key",
  "你的key",
]);

/** API Key 是否已真正配置（排除空值与常见占位符） */
function hasConfiguredKey(): boolean {
  return API_KEY.trim().length > 0 && !KEY_PLACEHOLDERS.has(API_KEY.trim().toLowerCase());
}
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
const API_BASE =
  process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta";

const DEFAULT_PROMPT = "请详细描述这张图片的内容";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // Gemini 单图约 20MB 上限，提前拦截超大输入
const URL_FETCH_TIMEOUT_MS = 60_000;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".tiff": "image/tiff",
};

function mimeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** 把用户给的图片来源解析为 Gemini inline_data 所需的 mimeType + base64 */
async function loadImageData(
  image: string
): Promise<{ mimeType: string; data: string }> {
  // 1) base64 data URI：data:image/png;base64,xxxx
  if (image.startsWith("data:")) {
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(image);
    if (!m) throw new Error("无效的 data URI（仅支持 base64 编码，形如 data:image/png;base64,xxxx）");
    if (!m[1].startsWith("image/")) throw new Error(`不支持的 data URI 类型：${m[1]}（仅接受 image/*）`);
    if (Math.ceil((m[2].length * 3) / 4) > MAX_IMAGE_BYTES) {
      throw new Error("图片超过大小上限（20MB）");
    }
    return { mimeType: m[1], data: m[2] };
  }

  // 2) http(s) URL：下载后转 base64（带超时与大小限制）
  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image, { signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`下载图片失败：HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_IMAGE_BYTES) throw new Error("图片超过大小上限（20MB）");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new Error("图片超过大小上限（20MB）");
    const mimeType =
      res.headers.get("content-type")?.split(";")[0].trim() ||
      mimeFromPath(new URL(image).pathname);
    return { mimeType, data: buf.toString("base64") };
  }

  // 3) 本地文件路径（相对/绝对均可）
  let st;
  try {
    st = await stat(image);
  } catch {
    throw new Error(`无法访问图片文件：${image}`);
  }
  if (!st.isFile()) throw new Error(`不是文件：${image}`);
  if (st.size > MAX_IMAGE_BYTES) throw new Error("图片超过大小上限（20MB）");
  const buf = await readFile(image);
  return { mimeType: mimeFromPath(image), data: buf.toString("base64") };
}

/** 调用 Gemini generateContent REST API */
async function callGemini(
  prompt: string,
  image: { mimeType: string; data: string },
  maxTokens: number
): Promise<string> {
  if (!hasConfiguredKey()) {
    throw new Error(
      "未配置 GEMINI_API_KEY。请通过环境变量设置你的 Gemini API Key（参见 README）。"
    );
  }
  const url = `${API_BASE}/models/${encodeURIComponent(MODEL)}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": API_KEY, // key 放请求头，避免出现在 URL/代理日志
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: image.mimeType, data: image.data } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: maxTokens,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let detail = errText;
    try {
      const j = JSON.parse(errText) as { error?: { message?: string } };
      if (j?.error?.message) detail = j.error.message;
    } catch {
      /* 非 JSON 响应则原样展示 */
    }
    throw new Error(
      `Gemini API 调用失败（HTTP ${res.status}）：${detail.slice(0, 800)}`
    );
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  const text = json.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .filter(Boolean)
    .join("\n");

  if (!text) {
    throw new Error(
      `模型未返回文本（finishReason=${
        json.candidates?.[0]?.finishReason ?? "未知"
      }，blockReason=${json.promptFeedback?.blockReason ?? "无"}）`
    );
  }
  return text;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "deepseek-vision-mcp",
  version: "0.1.0",
});

server.registerTool(
  "analyze_image",
  {
    title: "分析图片",
    description:
      "调用 Gemini 视觉模型（默认模型 gemini-3.5-flash，可用环境变量 GEMINI_MODEL 覆盖）分析一张图片，返回模型的文本描述/回答。image 支持本地文件路径、http(s) 图片 URL 或 base64 data URI。",
    inputSchema: {
      image: z
        .string()
        .describe("图片来源：本地文件路径、http(s) 图片 URL 或 data:image/...;base64,<data>"),
      prompt: z
        .string()
        .optional()
        .describe(`分析指令，默认为："${DEFAULT_PROMPT}"`),
      maxTokens: z
        .number()
        .int()
        .min(1)
        .max(8192)
        .optional()
        .describe("最大输出 token 数，默认 1024"),
    },
  },
  async ({ image, prompt, maxTokens }) => {
    try {
      if (!hasConfiguredKey()) {
        throw new Error(
          "未配置 GEMINI_API_KEY。请通过环境变量设置你的 Gemini API Key（参见 README）。"
        );
      }
      const img = await loadImageData(image);
      const text = await callGemini(prompt ?? DEFAULT_PROMPT, img, maxTokens ?? 1024);
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `[错误] ${msg}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// 启动（stdio transport）
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
if (!hasConfiguredKey()) {
  // stderr 不影响 stdio 协议（JSON-RPC 走 stdout）
  console.error(
    "[warn] 未检测到 GEMINI_API_KEY，analyze_image 调用会失败。请在启动前设置环境变量。"
  );
}
await server.connect(transport);
