import { NextRequest } from "next/server";
import {
  clearCookieHeader,
  createSessionToken,
  isAuthed,
  isFinanceConfigured,
  sessionCookieHeader,
  totpEnabled,
  verifyPassword,
  verifyTotp,
} from "../../../../lib/finance/auth";

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

export async function GET(request: NextRequest) {
  if (!isAuthed(request)) {
    return Response.json({ authed: false, totp: totpEnabled() }, { status: 401 });
  }
  return Response.json({ authed: true });
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return Response.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 }
    );
  }

  if (!isFinanceConfigured()) {
    return Response.json(
      { error: "Dashboard auth not configured (FINANCE_PASSWORD_HASH / FINANCE_SESSION_SECRET)." },
      { status: 500 }
    );
  }

  const { password, totp } = await request.json();
  if (typeof password !== "string" || !verifyPassword(password)) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }
  if (totpEnabled() && !verifyTotp(typeof totp === "string" ? totp : "")) {
    return Response.json({ error: "Invalid 2FA code" }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookieHeader(createSessionToken()));
  return response;
}

export async function DELETE() {
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", clearCookieHeader());
  return response;
}
