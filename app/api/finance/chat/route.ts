import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { parseMessages, streamChat } from "../../../../lib/finance/assistant";

// Ask the local model about your finances. Streams the reply as plain text.
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  // Belt and braces on top of the SameSite cookie: only this origin may ask.
  const origin = request.headers.get("origin");
  if (origin && URL.parse(origin)?.host !== request.headers.get("host")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = parseMessages(await request.json().catch(() => null));
  if (typeof messages === "string") return badRequest(messages);

  try {
    const stream = await streamChat(messages, request.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const offline = /fetch failed|ECONNREFUSED/i.test(message) || (err as { cause?: { code?: string } })?.cause?.code === "ECONNREFUSED";
    return Response.json(
      {
        error: offline
          ? "The local model server isn't running. Re-run scripts/local/install.sh."
          : message,
      },
      { status: 503 }
    );
  }
}
