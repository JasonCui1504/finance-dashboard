import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { buildInsightMessages, parseFacts } from "../../../../lib/finance/insights";
import { OLLAMA_MODEL, OllamaError, streamChat } from "../../../../lib/finance/llm";

// Read-only: turns the dashboard's summary figures into plain-text insights
// from the local model. Nothing is written to the database.
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const facts = parseFacts(await request.json().catch(() => null));
  if (!facts) return badRequest("Invalid insight summary");

  try {
    const stream = await streamChat(buildInsightMessages(facts), request.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Model": OLLAMA_MODEL,
      },
    });
  } catch (err) {
    if (err instanceof OllamaError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
