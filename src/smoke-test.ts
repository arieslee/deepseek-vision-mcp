/**
 * 端到端冒烟测试：spawn 编译后的 server，通过 stdio JSON-RPC 协议验证：
 *  1. initialize 握手成功
 *  2. tools/list 包含 analyze_image
 *  3. tools/call（无 API Key）返回 isError 且提示配置 GEMINI_API_KEY
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");

const child: ChildProcess = spawn(process.execPath, [serverPath], {
  // 强制清空 Key，验证"未配置"错误路径（若本机有 GEMINI_API_KEY 也不影响）
  env: { ...process.env, GEMINI_API_KEY: "" },
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const pending = new Map<number, (msg: any) => void>();
let nextId = 0;

child.stdout!.on("data", (d: Buffer) => {
  buf += d.toString();
  let idx: number;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  }
});

function send(method: string, params?: unknown): Promise<any> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`超时等待响应: ${method}`));
      }
    }, 15000);
  });
}

function assert(cond: boolean, label: string) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${label}`);
  }
}

try {
  // 1) initialize
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.1" },
  });
  assert(init.result?.serverInfo?.name === "gemini-vision-mcp", "initialize 握手成功");

  await send("notifications/initialized", {});

  // 2) tools/list
  const list = await send("tools/list", {});
  const tools: Array<{ name: string }> = list.result?.tools ?? [];
  assert(
    tools.some((t) => t.name === "analyze_image"),
    `tools/list 包含 analyze_image（实际: ${tools.map((t) => t.name).join(", ")}）`
  );

  // 3) tools/call（无 Key → 期望 isError）
  const call = await send("tools/call", {
    name: "analyze_image",
    arguments: { image: "C:/nope.png", prompt: "测试" },
  });
  const callResult = call.result ?? {};
  const text =
    callResult.content?.[0]?.text ?? "";
  assert(callResult.isError === true, "tools/call 无 Key 时返回 isError");
  assert(
    text.includes("GEMINI_API_KEY"),
    `错误信息提示配置 GEMINI_API_KEY（实际: ${text.slice(0, 120)}）`
  );
} catch (e) {
  console.error("FAIL:", e);
  process.exitCode = 1;
} finally {
  child.kill();
}
