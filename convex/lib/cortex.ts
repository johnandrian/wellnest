// Snowflake Cortex via its OpenAI-compatible chat completions endpoint.
import { env } from "./env";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// Text plus images (as data: URLs) for vision-capable models.
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: object };
};

export const CORE_MODEL = () => process.env.CORTEX_CORE_MODEL ?? "openai-gpt-5.4";
// For turns with a photo; must accept image input (defaults to the core model).
export const VISION_MODEL = () => process.env.CORTEX_VISION_MODEL ?? CORE_MODEL();

// A data: URL for an image, for ContentPart. Works without Node's Buffer.
export async function imageDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

export async function complete(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
}): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const base = env("SNOWFLAKE_ACCOUNT_URL").replace(/\/$/, "");
  const res = await fetch(`${base}/api/v2/cortex/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("SNOWFLAKE_PAT")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
      max_completion_tokens: opts.maxTokens ?? 1024,
      stream: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Cortex ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return { content: msg.content ?? null, toolCalls: msg.tool_calls ?? [] };
}
