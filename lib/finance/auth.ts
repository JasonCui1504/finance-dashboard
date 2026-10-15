import { createHmac, scryptSync, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export const FINANCE_COOKIE = "finance_auth";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days

// FINANCE_PASSWORD_HASH format: "<salt-hex>:<scrypt-hash-hex>", generated with:
//   node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');
//     console.log(s+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'your-password'

function sessionSecret(): string {
  const secret = process.env.FINANCE_SESSION_SECRET;
  if (!secret) throw new Error("FINANCE_SESSION_SECRET is not set");
  return secret;
}

export function isFinanceConfigured(): boolean {
  return Boolean(
    process.env.FINANCE_PASSWORD_HASH && process.env.FINANCE_SESSION_SECRET
  );
}

export function verifyPassword(password: string): boolean {
  const stored = process.env.FINANCE_PASSWORD_HASH;
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, saltHex, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

export function createSessionToken(): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_S * 1000;
  const payload = `fin.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const [prefix, expiresAtStr] = payload.split(".");
  if (prefix !== "fin") return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(sign(payload), "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function sessionCookieHeader(token: string): string {
  return `${FINANCE_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_S}; SameSite=Lax${
    process.env.VERCEL ? "; Secure" : ""
  }`;
}

export function clearCookieHeader(): string {
  return `${FINANCE_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Auth check for route handlers. */
export function isAuthed(request: NextRequest): boolean {
  return verifySessionToken(request.cookies.get(FINANCE_COOKIE)?.value);
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30s step) ----------
// Optional 2FA: set FINANCE_TOTP_SECRET to a base32 secret and add it to an
// authenticator app. Login then requires the 6-digit code.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpEnabled(): boolean {
  return Boolean(process.env.FINANCE_TOTP_SECRET);
}

function totpCode(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export function verifyTotp(code: string): boolean {
  const secretB32 = process.env.FINANCE_TOTP_SECRET;
  if (!secretB32) return true; // 2FA not enabled
  const cleaned = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const secret = base32Decode(secretB32);
  if (secret.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const c of [counter - 1, counter, counter + 1]) {
    const expected = Buffer.from(totpCode(secret, c));
    const actual = Buffer.from(cleaned);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      return true;
    }
  }
  return false;
}
