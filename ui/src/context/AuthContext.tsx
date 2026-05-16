import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type AuthMode = "none" | "password";

export interface AuthState {
  loading: boolean;
  mode: AuthMode;
  configured: boolean;
  authenticated: boolean;
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  login: (password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  setup: (password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthContextValue | null>(null);

async function fetchStatus(): Promise<Omit<AuthState, "loading"> | null> {
  try {
    const res = await fetch("/api/auth-status");
    const json = await res.json();
    if (!json.ok) return null;
    return {
      mode: json.data.mode,
      configured: Boolean(json.data.configured),
      authenticated: Boolean(json.data.authenticated),
    };
  } catch {
    return null;
  }
}

async function postJSON(path: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.ok) return { ok: true };
    return { ok: false, error: json.error ?? `request failed (${res.status})` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    loading: true,
    mode: "none",
    configured: false,
    authenticated: false,
  });

  const refresh = useCallback(async () => {
    const s = await fetchStatus();
    if (s) setState({ loading: false, ...s });
    else setState({ loading: false, mode: "none", configured: false, authenticated: false });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (password: string) => {
    const r = await postJSON("/api/login", { password });
    if (r.ok) await refresh();
    return r;
  }, [refresh]);

  const setup = useCallback(async (password: string) => {
    const r = await postJSON("/api/setup", { password });
    if (r.ok) await refresh();
    return r;
  }, [refresh]);

  const logout = useCallback(async () => {
    await postJSON("/api/logout", {});
    await refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => ({ ...state, refresh, login, setup, logout }), [state, refresh, login, setup, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
