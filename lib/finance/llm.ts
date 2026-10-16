// Local LLM via Ollama (https://ollama.com). Everything stays on this Mac:
// the model runs in the Ollama app and is reached over loopback only.

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class OllamaError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

/**
 * Starts a streamed chat completion and returns the reply as a plain-text
 * stream. Ollama sends NDJSON chunks; only the message text is forwarded.
 * Aborting `signal` stops generation in Ollama too.
 */
export async function streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: true,
        keep_alive: "10m",
        options: { temperature: 0.3, num_ctx: 4096 },
      }),
      signal,
    });
  } catch {
    throw new OllamaError(
      `Couldn't reach Ollama at ${OLLAMA_URL}. Is the Ollama app running?`,
      503
    );
  }
  if (!res.ok || !res.body) {
    const detail = await res.json().then((j) => j?.error, () => null);
    throw new OllamaError(
      detail ? `Ollama: ${detail}` : `Ollama returned ${res.status}`,
      res.status === 404 ? 404 : 502
    );
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const emit = (line: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
    if (chunk.error) throw new OllamaError(`Ollama: ${chunk.error}`);
    if (chunk.message?.content) controller.enqueue(encoder.encode(chunk.message.content));
  };

  return res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) emit(line, controller);
      },
      flush(controller) {
        emit(buffer + decoder.decode(), controller);
      },
    })
  );
}
