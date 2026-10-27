"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { safeLoginDestination } from "@/lib/login-destination";

function safeDestination(): string {
  const destination = new URLSearchParams(window.location.search).get("next");
  return safeLoginDestination(destination, window.location.origin);
}

function LoginForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const failureMessage = async (response: Response): Promise<string> => {
    if (response.status === 401) return "Incorrect password";
    if (response.status !== 429) return "Could not log in. Try again.";
    const seconds = Number(response.headers.get("retry-after"));
    return `Too many failed attempts. Try again in ${Number.isFinite(seconds) && seconds > 0 ? seconds : 1}s.`;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/web-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(await failureMessage(response));
        return;
      }
      window.location.replace(safeDestination());
    } catch {
      setError("Could not log in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="web-login-page">
      <div className="web-login-shell">
        <header className="web-login-brand">
          <Image src="/icons/apple-touch-icon.png" width={52} height={52} alt="" priority />
          <div>
            <h1>Pi Web</h1>
            <p>{"Sign in to continue"}</p>
          </div>
        </header>
        <form className="web-login-form" onSubmit={submit}>
          <div className="web-login-composer">
            <label className="web-login-label" htmlFor="web-login-password">{"Password"}</label>
            <input
              id="web-login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={"Password"}
              autoComplete="current-password"
              autoFocus
              required
              disabled={busy}
            />
            <button type="submit" disabled={busy || !password}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="2" y1="7" x2="11" y2="7" />
                <polyline points="7.5 3 12 7 7.5 11" />
              </svg>
              {busy ? "Logging in..." : "Log in"}
            </button>
          </div>
          <p className="web-login-error" role="alert" aria-live="polite">{error}</p>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}
