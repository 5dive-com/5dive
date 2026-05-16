import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { LogoMark } from "./Logo";

export function LoginScreen() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await login(password);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setPassword("");
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-surface-page px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-surface-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <LogoMark className="size-8" />
          <div className="flex items-center gap-1.5">
            <span className="text-[1.0625rem] font-semibold tracking-tight text-ink">5dive</span>
            <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[0.625rem] font-medium text-ink-muted">
              local
            </span>
          </div>
        </div>

        <h1 className="mb-1 text-[1.25rem] font-semibold tracking-tight text-ink">Sign in</h1>
        <p className="mb-6 text-[0.8125rem] text-ink-secondary">
          Enter the admin password set via <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[0.75rem]">5dive ui setup</code>.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            disabled={busy}
            className="w-full rounded-lg border border-border-subtle bg-surface-card px-3 py-2.5 text-[0.875rem] text-ink outline-none focus:border-signal disabled:opacity-50"
          />
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[0.8125rem] text-red-700">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full rounded-xl bg-signal px-4 py-2.5 text-[0.875rem] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
