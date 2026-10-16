import type { NextRequest } from "next/server";
import { isAuthed } from "./auth";

/** Returns a 401 response if the request has no valid session, else null. */
export function requireSession(request: NextRequest): Response | null {
  if (!isAuthed(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** A trimmed label of 1–40 characters, or null. */
export function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, " ");
  return s.length >= 1 && s.length <= 40 ? s : null;
}
