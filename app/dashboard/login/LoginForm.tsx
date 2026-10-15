"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/finance/auth")
      .then(async (res) => {
        if (res.ok) {
          router.replace("/dashboard");
          return;
        }
        const data = await res.json().catch(() => null);
        if (data?.totp) setTotpRequired(true);
      })
      .catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/finance/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, totp }),
      });
      if (res.ok) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Login failed");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm text-subtle">
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          className="rounded-md border border-line bg-surface px-3 py-2 text-prose outline-none focus:border-accent"
        />
      </label>
      {totpRequired && (
        <label className="flex flex-col gap-1.5 text-sm text-subtle">
          2FA code
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            placeholder="123456"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            required
            className="rounded-md border border-line bg-surface px-3 py-2 text-prose outline-none focus:border-accent"
          />
        </label>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
