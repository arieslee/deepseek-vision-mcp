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
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[m[1]] = value;
    }
  }
}
loadDotEnv();

const API_KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
const API_BASE =
  process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta";

const DEFAULT_PROMPT = "请详细描述这张图片的内容";

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
    return { mimeType: m[1], data: m[2] };
  }

  // 2) http(s) URL：下载后转 base64
  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image);
    if (!res.ok) throw new Error(`下载图片失败：HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
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
  const buf = await readFile(image);
  return { mimeType: mimeFromPath(image), data: buf.toString("base64") };
}

/** 调用 Gemini generateContent REST API */
async function callGemini(
  prompt: string,
  image: { mimeType: string; data: string },
  maxTokens: number
): Promise<string> {
  if (!API_KEY) {
    throw new Error(
      "未配置 GEMINI_API_KEY。请通过环境变量设置你的 Gemini API Key（参见 README）。"
    );
  }
  const url = `${API_BASE}/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(
    API_KEY
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    throw new Error(
      `Gemini API 调用失败（HTTP ${res.status}）：${errText.slice(0, 800)}`
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
      if (!API_KEY) {
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
if (!API_KEY) {
  // stderr 不影响 stdio 协议（JSON-RPC 走 stdout）
  console.error(
    "[warn] 未检测到 GEMINI_API_KEY，analyze_image 调用会失败。请在启动前设置环境变量。"
  );
}
await server.connect(transport);
