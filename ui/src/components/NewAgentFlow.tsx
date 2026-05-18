import { useEffect, useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Spinner } from "@heroui/react";
import { ChevronLeft, Check } from "lucide-react";
import { TYPE_ICON, CHANNEL_ICON } from "./icons";

type IconComponent = ComponentType<{ className?: string } & SVGProps<SVGSVGElement>>;

interface Props {
  onExit: () => void;
  onCreated: (createdName?: string) => void;
}

const TYPES = ["claude", "codex", "gemini", "hermes", "openclaw", "opencode"] as const;
type AgentType = typeof TYPES[number];

const TYPE_BLURB: Record<AgentType, string> = {
  claude:   "Anthropic's coding agent — recommended.",
  codex:    "OpenAI's coding agent.",
  gemini:   "Google's coding agent.",
  hermes:   "Open-source agent — bring your own provider.",
  openclaw: "Open-source agent — bring your own provider.",
  opencode: "Open-source agent backed by your OpenAI key.",
};

const RECOMMENDED: AgentType = "claude";

const ISOLATION_OPTIONS = [
  { value: "admin",     label: "Admin",     desc: "Full server access. Use for trusted local work." },
  { value: "standard",  label: "Standard",  desc: "Read-only /home/claude. Safe default for most agents." },
  { value: "sandboxed", label: "Sandboxed", desc: "Own home dir only. Best for untrusted prompts." },
] as const;
type IsolationLevel = typeof ISOLATION_OPTIONS[number]["value"];

const OAUTH_TYPES = new Set<AgentType>(["claude"]);
const CHANNEL_SUPPORTED = new Set<AgentType>(["claude", "hermes", "openclaw"]);
const PROVIDER_TYPES = new Set<AgentType>(["hermes", "openclaw"]);

const PROVIDERS = [
  "openrouter", "anthropic", "openai", "google", "deepseek",
  "qwen", "nous", "minimax", "moonshot", "huggingface", "zai",
] as const;

const PROVIDER_KEY_LABELS: Record<string, string> = {
  openrouter:  "OpenRouter API key",
  anthropic:   "Anthropic API key",
  openai:      "OpenAI API key",
  google:      "Google AI API key",
  deepseek:    "DeepSeek API key",
  qwen:        "Qwen API key",
  nous:        "Nous API key",
  minimax:     "Minimax API key",
  moonshot:    "Moonshot API key",
  huggingface: "HuggingFace API key",
  zai:         "Zai API key",
};

const PROVIDER_KEY_PLACEHOLDERS: Record<string, string> = {
  openrouter:  "sk-or-v1-…",
  anthropic:   "sk-ant-…",
  openai:      "sk-…",
  google:      "AIza…",
  deepseek:    "sk-…",
  qwen:        "sk-…",
  nous:        "sk-…",
  minimax:     "sk-…",
  moonshot:    "sk-…",
  huggingface: "hf_…",
  zai:         "sk-…",
};

const PROVIDER_DOCS: Record<string, string> = {
  openrouter:  "https://openrouter.ai/keys",
  anthropic:   "https://console.anthropic.com/settings/keys",
  openai:      "https://platform.openai.com/api-keys",
  google:      "https://aistudio.google.com/apikey",
  deepseek:    "https://platform.deepseek.com",
  qwen:        "https://dashscope.aliyuncs.com",
  nous:        "https://dashboard.nous.research.ai",
  minimax:     "https://www.minimax.io",
  moonshot:    "https://platform.moonshot.cn",
  huggingface: "https://huggingface.co/settings/tokens",
  zai:         "https://platform.zhipuai.cn",
};

const AUTH_HELP: Record<AgentType, { label: string; placeholder: string; docsUrl: string }> = {
  claude:   { label: "Anthropic API key (optional)", placeholder: "sk-ant-api03-…", docsUrl: "https://console.anthropic.com/settings/keys" },
  codex:    { label: "OpenAI API key",   placeholder: "sk-…",      docsUrl: "https://platform.openai.com/api-keys" },
  gemini:   { label: "Gemini API key",   placeholder: "AIza…",     docsUrl: "https://aistudio.google.com/apikey" },
  hermes:   { label: "API key",          placeholder: "sk-…",      docsUrl: "https://openrouter.ai/keys" },
  openclaw: { label: "API key",          placeholder: "sk-…",      docsUrl: "https://openrouter.ai/keys" },
  opencode: { label: "OpenAI API key",   placeholder: "sk-…",      docsUrl: "https://platform.openai.com/api-keys" },
};

const NAME_RE = /^[a-z][a-z0-9-]{0,15}$/;
const NAME_HINT = "Lowercase letters, digits and hyphens. Starts with a letter. Max 16 chars.";

type Step =
  | "agent"
  | "name"
  | "isolation"
  | "provider"
  | "auth"
  | "channel"
  | "token"
  | "creating";

type ChannelId = "none" | "telegram" | "discord";

function stepsFor(type: AgentType | null, authNeeded: boolean): Step[] {
  const steps: Step[] = ["agent", "name", "isolation"];
  if (type && PROVIDER_TYPES.has(type)) steps.push("provider");
  if (authNeeded) steps.push("auth");
  if (type && CHANNEL_SUPPORTED.has(type)) steps.push("channel");
  return steps;
}

// OAuth poll states emitted by `5dive agent auth poll` (see src/cmd_auth.sh).
type OAuthState = "pending_url" | "awaiting_code" | "submitted" | "ok" | "expired" | "error";

// Types whose device-code flow shows a one-time code in the browser instead
// of returning a callback code the user has to paste back. The CLI polls the
// upstream provider on these itself and writes auth.json when ok.
const OAUTH_DISPLAY_CODE_TYPES = new Set<AgentType>(["codex", "hermes", "openclaw"]);
// Types where the user pastes the callback code back into the dashboard.
const OAUTH_PASTE_CODE_TYPES = new Set<AgentType>(["claude", "gemini"]);

export function NewAgentFlow({ onExit, onCreated }: Props) {
  const [step, setStep] = useState<Step>("agent");

  const [type, setType] = useState<AgentType | null>(null);
  const [name, setName] = useState("");
  const [isolation, setIsolation] = useState<IsolationLevel>("admin");
  const [channel, setChannel] = useState<ChannelId>("none");
  const [channelToken, setChannelToken] = useState("");

  // Auth state — `authStatusLoaded` gates step routing so we never skip the
  // auth step on a stale default while the status fetch is still in flight.
  const [authNeeded, setAuthNeeded] = useState(false);
  const [authStatusLoaded, setAuthStatusLoaded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<string>("openrouter");

  // OAuth session — sessionId comes back from /start, then poll/submit/cancel
  // each operate against it. callbackCode is the user-pasted code for
  // claude/gemini; codex/hermes/openclaw never collect it.
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthDisplayCode, setOauthDisplayCode] = useState<string | null>(null);
  const [oauthState, setOauthState] = useState<OAuthState | null>(null);
  const [callbackCode, setCallbackCode] = useState("");
  const oauthPolling = oauthState !== null && oauthState !== "ok" && oauthState !== "error" && oauthState !== "expired";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-create-attempt counter so the create useEffect re-fires on retry.
  // Bumping this when the user clicks Retry triggers a fresh POST without
  // having to leave + re-enter the "creating" step.
  const [createAttempt, setCreateAttempt] = useState(0);

  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const oauthPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    if (oauthPollTimer.current) clearInterval(oauthPollTimer.current);
  }, []);

  useEffect(() => {
    if (!type) return;
    let cancelled = false;
    setAuthStatusLoaded(false);
    fetch(`/api/auth/${type}`)
      .then(r => r.json())
      .then((j: { ok: boolean; data?: Record<string, string> }) => {
        if (cancelled) return;
        const status = j.ok ? (j.data?.[type] ?? "needs_login") : "needs_login";
        setAuthNeeded(status !== "ok");
        setAuthStatusLoaded(true);
      })
      .catch(() => { if (!cancelled) { setAuthNeeded(true); setAuthStatusLoaded(true); } });
    if (!CHANNEL_SUPPORTED.has(type)) setChannel("none");
    return () => { cancelled = true; };
  }, [type]);

  /* ------------------------- step navigation ------------------------- */

  const stepAfterIsolation = (t: AgentType): Step => {
    if (PROVIDER_TYPES.has(t)) return "provider";
    if (authNeeded) return "auth";
    if (CHANNEL_SUPPORTED.has(t)) return "channel";
    return "creating";
  };

  const stepAfterProvider = (t: AgentType): Step => {
    if (authNeeded) return "auth";
    if (CHANNEL_SUPPORTED.has(t)) return "channel";
    return "creating";
  };

  const stepAfterAuth = (t: AgentType): Step => {
    if (CHANNEL_SUPPORTED.has(t)) return "channel";
    return "creating";
  };

  const stepBefore = (s: Step): Step | "exit" => {
    if (s === "agent") return "exit";
    if (s === "name") return "agent";
    if (s === "isolation") return "name";
    if (s === "provider") return "isolation";
    if (s === "auth") {
      if (type && PROVIDER_TYPES.has(type)) return "provider";
      return "isolation";
    }
    if (s === "channel") {
      if (authNeeded) return "auth";
      if (type && PROVIDER_TYPES.has(type)) return "provider";
      return "isolation";
    }
    if (s === "token") return "channel";
    return "exit";
  };

  const backLabel = (() => {
    switch (step) {
      case "name":      return "Change agent";
      case "isolation": return "Rename agent";
      case "provider":  return "Change isolation";
      case "auth":      return type && PROVIDER_TYPES.has(type) ? "Change provider" : "Change isolation";
      case "channel":   return authNeeded ? "Change sign-in"
                                : type && PROVIDER_TYPES.has(type) ? "Change provider"
                                : "Change isolation";
      case "token":     return "Change channel";
      default:          return "My Agents";
    }
  })();

  const handleBack = () => {
    if (step === "creating") return;
    setError(null);
    const prev = stepBefore(step);
    if (prev === "exit") onExit();
    else setStep(prev);
  };

  /* ---------------------------- handlers ----------------------------- */

  const handleAgentSelect = (t: AgentType) => {
    setType(t);
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = setTimeout(() => setStep("name"), 320);
  };

  const handleNameContinue = () => {
    setError(null);
    if (!NAME_RE.test(name)) {
      setError(NAME_HINT);
      return;
    }
    setStep("isolation");
  };

  const handleIsolationContinue = () => {
    if (!type) return;
    // Wait for auth status before deciding whether to show the auth step —
    // without this the routing reads a stale `authNeeded=false` default and
    // skips auth on every first-time agent.
    if (!authStatusLoaded) return;
    setStep(stepAfterIsolation(type));
  };

  const handleProviderContinue = () => {
    if (!type) return;
    if (!authStatusLoaded) return;
    setStep(stepAfterProvider(type));
  };

  const handleChannelContinue = () => {
    setError(null);
    if (channel === "none") setStep("creating");
    else setStep("token");
  };

  const handleTokenContinue = () => {
    if (!channelToken.trim()) {
      setError(channel === "discord" ? "Discord bot token is required" : "Telegram bot token is required");
      return;
    }
    setError(null);
    setStep("creating");
  };

  // OAuth — start the device-code session and kick off polling.
  const startOAuth = async () => {
    if (!type) return;
    setError(null);
    setOauthUrl(null);
    setOauthDisplayCode(null);
    setCallbackCode("");
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${type}/start`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) {
        setError(typeof j.error === "string" ? j.error : (j.error?.message ?? "Failed to start login"));
        return;
      }
      const sid = j.data.sessionId as string;
      setOauthSessionId(sid);
      setOauthState("pending_url");
      pollOAuth(sid);
    } finally {
      setBusy(false);
    }
  };

  // Cancel any in-flight session before starting a new one. Best-effort —
  // a stale session expires server-side either way, but cancel-on-retry
  // keeps the CLI's session list tidy.
  const cancelOAuth = async () => {
    if (!type || !oauthSessionId) return;
    try { await fetch(`/api/auth/${type}/cancel/${oauthSessionId}`, { method: "POST" }); } catch { /* ignore */ }
    if (oauthPollTimer.current) { clearInterval(oauthPollTimer.current); oauthPollTimer.current = null; }
    setOauthSessionId(null);
    setOauthState(null);
    setOauthUrl(null);
    setOauthDisplayCode(null);
    setCallbackCode("");
  };

  const pollOAuth = (sessionId: string) => {
    if (!type) return;
    if (oauthPollTimer.current) clearInterval(oauthPollTimer.current);
    oauthPollTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/${type}/poll/${sessionId}`);
        const j = await res.json();
        if (!j.ok) return;
        const { state, url, code, error: errMsg } = j.data as {
          state: OAuthState;
          url: string | null;
          code?: string | null;
          error?: string | null;
        };
        if (url) setOauthUrl(url);
        if (code) setOauthDisplayCode(code);
        setOauthState(state);

        // Terminal states: stop polling and either advance or surface error.
        if (state === "ok") {
          if (oauthPollTimer.current) { clearInterval(oauthPollTimer.current); oauthPollTimer.current = null; }
          setStep(stepAfterAuth(type));
        } else if (state === "expired" || state === "error") {
          if (oauthPollTimer.current) { clearInterval(oauthPollTimer.current); oauthPollTimer.current = null; }
          setError(errMsg || (state === "expired" ? "Sign-in session expired" : "Authentication failed"));
        }
      } catch { /* keep polling — transient network errors recover */ }
    }, 2000);
  };

  // For claude / gemini: user pastes the callback code from the browser back
  // into the dashboard. We POST it; the server runs `agent auth submit`,
  // which feeds the code into the tmux'd CLI session and flips state to
  // submitted/ok.
  const submitCallbackCode = async () => {
    if (!type || !oauthSessionId) return;
    if (!callbackCode.trim()) { setError("Paste the code from the browser"); return; }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${type}/submit/${oauthSessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: callbackCode.trim() }),
      });
      const j = await res.json();
      if (!j.ok) {
        const e = j.error;
        setError(typeof e === "string" ? e : (e?.message ?? "Submit failed"));
        return;
      }
      // Keep polling — submit flips state to "submitted", then "ok" once
      // the upstream session confirms.
      setOauthState("submitted");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const submitApiKey = async () => {
    if (!type) return;
    setError(null);
    if (!apiKey.trim()) { setError("API key is required"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          ...(PROVIDER_TYPES.has(type) ? { provider } : {}),
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        const e = j.error;
        setError(typeof e === "string" ? e : (e?.message ?? "Authentication failed"));
        return;
      }
      setStep(stepAfterAuth(type));
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  // Final create — fires when "creating" is reached AND on every retry
  // (createAttempt bump). On failure we stay on the "creating" step and
  // surface a retry button; form state (name, isolation, channel, token,
  // apiKey) lives in useState above so the user's input is never lost.
  useEffect(() => {
    if (step !== "creating" || !type) return;
    let cancelled = false;
    (async () => {
      setError(null);
      setBusy(true);
      try {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            type,
            isolation,
            channels: channel,
            telegramToken: channel === "telegram" ? channelToken : "",
            discordToken:  channel === "discord"  ? channelToken : "",
          }),
        });
        const j = await res.json();
        if (cancelled) return;
        if (j.ok) {
          onCreated(name.trim());
        } else {
          const e = j.error;
          setError(typeof e === "string" ? e : (e?.message ?? "Failed to create agent"));
        }
      } catch {
        if (cancelled) return;
        setError("Network error — agent was not created");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, createAttempt, type, name, isolation, channel, channelToken, onCreated]);

  const retryCreate = () => setCreateAttempt(n => n + 1);
  const editAndRetry = (target: Step) => { setError(null); setStep(target); };

  /* ----------------------------- render ------------------------------ */

  const steps = stepsFor(type, authNeeded);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-page">
      {/* Soft signal glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,var(--color-signal-soft)_0%,transparent_70%)]" />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 lg:px-10">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === "creating"}
          className="flex items-center gap-1.5 text-[0.8125rem] text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          <ChevronLeft className="size-4" />
          {backLabel}
        </button>
        {step !== "creating" && (
          <StepDots current={step} steps={steps} />
        )}
      </header>

      <main className="relative z-10 flex flex-1 items-start justify-center overflow-y-auto px-6 pb-16 pt-4 lg:px-10">
        <AnimatePresence mode="wait">
          {step === "agent" && (
            <AgentStep
              key="agent"
              selected={type}
              onSelect={handleAgentSelect}
            />
          )}
          {step === "name" && type && (
            <NameStep
              key="name"
              type={type}
              value={name}
              onChange={setName}
              error={error}
              onContinue={handleNameContinue}
            />
          )}
          {step === "isolation" && type && (
            <IsolationStep
              key="isolation"
              type={type}
              name={name}
              selected={isolation}
              onSelect={setIsolation}
              onContinue={handleIsolationContinue}
            />
          )}
          {step === "provider" && type && (
            <ProviderStep
              key="provider"
              type={type}
              selected={provider}
              onSelect={setProvider}
              onContinue={handleProviderContinue}
            />
          )}
          {step === "auth" && type && (
            <AuthStep
              key="auth"
              type={type}
              provider={provider}
              isOauth={OAUTH_TYPES.has(type)}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              oauthUrl={oauthUrl}
              oauthDisplayCode={oauthDisplayCode}
              oauthState={oauthState}
              oauthPolling={oauthPolling}
              callbackCode={callbackCode}
              onCallbackCodeChange={setCallbackCode}
              busy={busy}
              error={error}
              onStartOAuth={startOAuth}
              onCancelOAuth={cancelOAuth}
              onSubmitCallbackCode={submitCallbackCode}
              onSubmitKey={submitApiKey}
            />
          )}
          {step === "channel" && type && (
            <ChannelStep
              key="channel"
              type={type}
              selected={channel}
              onSelect={setChannel}
              onContinue={handleChannelContinue}
            />
          )}
          {step === "token" && (
            <TokenStep
              key="token"
              channel={channel === "discord" ? "discord" : "telegram"}
              value={channelToken}
              onChange={setChannelToken}
              error={error}
              onContinue={handleTokenContinue}
            />
          )}
          {step === "creating" && (
            <CreatingStep
              key="creating"
              name={name}
              busy={busy}
              error={error}
              channelSelected={channel !== "none"}
              onRetry={retryCreate}
              onEditChannel={() => editAndRetry(channel !== "none" ? "token" : "channel")}
              onEditIsolation={() => editAndRetry("isolation")}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Reusable bits                                                       */
/* -------------------------------------------------------------------- */

function StepDots({ current, steps }: { current: Step; steps: Step[] }) {
  const idx = steps.indexOf(current);
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => (
        <div
          key={s}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === idx ? "w-6 bg-signal" : i < idx ? "w-1.5 bg-signal/60" : "w-1.5 bg-border-hard"
          }`}
        />
      ))}
    </div>
  );
}

function StepShell({
  eyebrow,
  title,
  subtitle,
  children,
  maxWidth = "max-w-3xl",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className={`flex w-full ${maxWidth} flex-col items-center text-center`}
    >
      {eyebrow && (
        <p className="mb-2 text-[0.75rem] font-semibold uppercase tracking-[0.15em] text-signal">
          {eyebrow}
        </p>
      )}
      <h1 className="mb-3 text-3xl font-semibold tracking-[-0.025em] text-ink sm:text-4xl">
        {title}
      </h1>
      {subtitle && (
        <p className="mb-10 max-w-md text-[0.9375rem] text-ink-secondary">
          {subtitle}
        </p>
      )}
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------- */
/*  Step 1 — Pick agent                                                 */
/* -------------------------------------------------------------------- */

function AgentStep({
  selected,
  onSelect,
}: {
  selected: AgentType | null;
  onSelect: (t: AgentType) => void;
}) {
  return (
    <StepShell
      eyebrow="Add agent"
      title="Pick your agent"
      subtitle="Each one runs on this machine, signed into your account."
    >
      <div className="mb-8 grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
        {TYPES.map((t, i) => {
          const Icon = TYPE_ICON[t] ?? TYPE_ICON.claude;
          const isSelected = selected === t;
          const isDimmed = selected !== null && selected !== t;
          const isRecommended = t === RECOMMENDED;
          return (
            <motion.button
              key={t}
              type="button"
              onClick={() => onSelect(t)}
              disabled={isDimmed}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: isDimmed ? 0.4 : 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              whileHover={isDimmed ? undefined : { y: -2 }}
              className={`relative flex flex-col items-center gap-3 rounded-2xl p-5 text-center transition-colors ${
                isSelected
                  ? "bg-signal-soft ring-1 ring-inset ring-signal/40"
                  : "bg-surface-card/60 hover:bg-surface-card"
              }`}
            >
              {isRecommended && !isSelected && (
                <span className="absolute left-1/2 top-3 -translate-x-1/2 text-[0.5625rem] font-semibold uppercase tracking-[0.15em] text-signal">
                  Recommended
                </span>
              )}
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-signal text-white"
                >
                  <Check className="size-3" />
                </motion.div>
              )}
              <div
                className={`mt-3 flex size-14 items-center justify-center rounded-2xl bg-white text-zinc-900 ring-1 ring-black/5 transition-shadow ${
                  isSelected
                    ? "shadow-[0_16px_40px_-16px_rgba(0,74,255,0.35)]"
                    : "shadow-[0_10px_30px_-15px_rgba(0,0,0,0.2)]"
                }`}
              >
                <Icon className="size-7" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[0.875rem] font-semibold tracking-[-0.005em] text-ink">
                  {t}
                </span>
                <span className="text-[0.75rem] text-ink-secondary">
                  {TYPE_BLURB[t]}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </StepShell>
  );
}

/* -------------------------------------------------------------------- */
/*  Step 2 — Name                                                       */
/* -------------------------------------------------------------------- */

function NameStep({
  type,
  value,
  onChange,
  error,
  onContinue,
}: {
  type: AgentType;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  onContinue: () => void;
}) {
  const Icon = TYPE_ICON[type] ?? TYPE_ICON.claude;
  const touched = value.length > 0;
  const valid = NAME_RE.test(value);
  const showError = (touched && !valid) || Boolean(error);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="flex w-full max-w-md flex-col items-center text-center"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative mb-6"
      >
        <div className="pointer-events-none absolute inset-0 -z-10 scale-150 rounded-full bg-signal/10 blur-3xl" />
        <div className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] ring-1 ring-black/5">
          <Icon className="size-8 text-zinc-900" />
        </div>
      </motion.div>

      <p className="mb-2 text-[0.75rem] font-semibold uppercase tracking-[0.15em] text-signal">
        Name this {type}
      </p>
      <h1 className="mb-3 text-3xl font-semibold tracking-[-0.025em] text-ink sm:text-4xl">
        Give it a handle
      </h1>
      <p className="mb-8 max-w-sm text-[0.9375rem] text-ink-secondary">
        Short, lowercase, no spaces — you'll use it to address the agent.
      </p>

      <div className="mb-6 flex w-full flex-col gap-2 text-left">
        <label
          htmlFor="agent-name"
          className="text-[0.75rem] font-medium uppercase tracking-[0.08em] text-ink-muted"
        >
          Agent name
        </label>
        <input
          id="agent-name"
          type="text"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) {
              e.preventDefault();
              onContinue();
            }
          }}
          placeholder="my-agent"
          className={`rounded-xl border bg-surface-card px-4 py-3 text-[1rem] text-ink outline-none transition-colors ${
            showError ? "border-red-500/60" : "border-border-subtle focus:border-signal"
          }`}
        />
        <p className={`text-[0.75rem] ${showError ? "text-red-500" : "text-ink-muted"}`}>
          {error ?? NAME_HINT}
        </p>
      </div>

      <Button
        className="bg-signal text-white"
        isDisabled={!valid}
        onPress={onContinue}
      >
        Continue
      </Button>
    </motion.div>
  );
}

/* -------------------------------------------------------------------- */
/*  Step 3 — Isolation                                                  */
/* -------------------------------------------------------------------- */

function IsolationStep({
  type,
  name,
  selected,
  onSelect,
  onContinue,
}: {
  type: AgentType;
  name: string;
  selected: IsolationLevel;
  onSelect: (v: IsolationLevel) => void;
  onContinue: () => void;
}) {
  return (
    <StepShell
      eyebrow={`${type} · ${name}`}
      title="How locked-down?"
      subtitle="Pick how much access this agent has to the host. You can keep it loose for trusted local work, or tighten it for untrusted prompts."
      maxWidth="max-w-2xl"
    >
      <div className="mb-8 flex w-full flex-col gap-3">
        {ISOLATION_OPTIONS.map((opt, i) => {
          const isSelected = selected === opt.value;
          return (
            <motion.button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              whileHover={{ y: -1 }}
              className={`flex w-full items-start gap-4 rounded-2xl p-5 text-left transition-colors ${
                isSelected
                  ? "bg-signal-soft ring-1 ring-inset ring-signal/40"
                  : "bg-surface-card/60 hover:bg-surface-card"
              }`}
            >
              <div className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                isSelected ? "border-signal bg-signal" : "border-border-hard"
              }`}>
                {isSelected && <Check className="size-3 text-white" />}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <span className={`text-[0.9375rem] font-semibold ${isSelected ? "text-signal" : "text-ink"}`}>
                  {opt.label}
                </span>
                <span className="text-[0.8125rem] text-ink-secondary">{opt.desc}</span>
              </div>
            </motion.button>
          );
        })}
      </div>

      <Button className="bg-signal text-white" onPress={onContinue}>
        Continue
      </Button>
    </StepShell>
  );
}

/* -------------------------------------------------------------------- */
/*  Step 4 — Provider (hermes / openclaw)                               */
/* -------------------------------------------------------------------- */

function ProviderStep({
  type,
  selected,
  onSelect,
  onContinue,
}: {
  type: AgentType;
  selected: string;
  onSelect: (p: string) => void;
  onContinue: () => void;
}) {
  return (
    <StepShell
      eyebrow={`${type} · provider`}
      title="Bring your own provider"
      subtitle="This agent type runs on any major model API. Pick the one you have a key for."
      maxWidth="max-w-2xl"
    >
      <div className="mb-8 grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
        {PROVIDERS.map((p) => {
          const isSelected = selected === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onSelect(p)}
              className={`flex items-center justify-center rounded-xl px-3 py-3 text-[0.875rem] font-medium transition-colors ${
                isSelected
                  ? "bg-signal-soft text-signal ring-1 ring-inset ring-signal/40"
                  : "bg-surface-card/60 text-ink-secondary hover:bg-surface-card hover:text-ink"
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>

      <Button className="bg-signal text-white" onPress={onContinue}>
        Continue
      </Button>
    </StepShell>
  );
}

/* -------------------------------------------------------------------- */
/*  Step 5 — Auth (OAuth or API key)                                    */
/* -------------------------------------------------------------------- */

function AuthStep({
  type,
  provider,
  isOauth,
  apiKey,
  onApiKeyChange,
  oauthUrl,
  oauthDisplayCode,
  oauthState,
  oauthPolling,
  callbackCode,
  onCallbackCodeChange,
  busy,
  error,
  onStartOAuth,
  onCancelOAuth,
  onSubmitCallbackCode,
  onSubmitKey,
}: {
  type: AgentType;
  provider: string;
  isOauth: boolean;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  oauthUrl: string | null;
  oauthDisplayCode: string | null;
  oauthState: OAuthState | null;
  oauthPolling: boolean;
  callbackCode: string;
  onCallbackCodeChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  onStartOAuth: () => void;
  onCancelOAuth: () => void;
  onSubmitCallbackCode: () => void;
  onSubmitKey: () => void;
}) {
  const Icon = TYPE_ICON[type] ?? TYPE_ICON.claude;
  const isProvider = PROVIDER_TYPES.has(type);
  const label = isProvider ? (PROVIDER_KEY_LABELS[provider] ?? "API key") : AUTH_HELP[type].label;
  const placeholder = isProvider ? (PROVIDER_KEY_PLACEHOLDERS[provider] ?? "sk-…") : AUTH_HELP[type].placeholder;
  const docsUrl = isProvider ? (PROVIDER_DOCS[provider] ?? "#") : AUTH_HELP[type].docsUrl;

  // Which OAuth variant is this type? Codex/hermes/openclaw show a code in
  // the browser; the user types that code on the upstream page (we just
  // display it for verification) and the CLI polls upstream itself.
  // Claude/gemini print a callback code in the browser that the user
  // pastes back into the dashboard — we collect and submit it.
  const wantsPasteCode = OAUTH_PASTE_CODE_TYPES.has(type);
  const showsDisplayCode = OAUTH_DISPLAY_CODE_TYPES.has(type);
  const terminal = oauthState === "ok" || oauthState === "error" || oauthState === "expired";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="flex w-full max-w-md flex-col items-center text-center"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative mb-6"
      >
        <div className="pointer-events-none absolute inset-0 -z-10 scale-150 rounded-full bg-signal/10 blur-3xl" />
        <div className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] ring-1 ring-black/5">
          <Icon className="size-8 text-zinc-900" />
        </div>
      </motion.div>

      <p className="mb-2 text-[0.75rem] font-semibold uppercase tracking-[0.15em] text-signal">
        Connect {type}
      </p>
      <h1 className="mb-3 text-3xl font-semibold tracking-[-0.025em] text-ink sm:text-4xl">
        Sign in
      </h1>
      <p className="mb-8 max-w-sm text-[0.9375rem] text-ink-secondary">
        Not yet authenticated on this machine. Connect once and every {type} agent reuses the same credentials.
      </p>

      {isOauth ? (
        <div className="flex w-full flex-col gap-3">
          {/* Pre-start: a single CTA to kick off the device-code session. */}
          {oauthState === null && (
            <Button
              className="bg-signal text-white"
              isDisabled={busy}
              onPress={onStartOAuth}
            >
              {busy && <Spinner size="sm" />}
              Sign in with {type}
            </Button>
          )}

          {/* In-flight: waiting for the CLI to print a URL (and code for some types). */}
          {oauthState === "pending_url" && (
            <div className="flex items-center justify-center gap-2 text-[0.8125rem] text-ink-muted">
              <div className="size-3.5 animate-spin rounded-full border-2 border-border-subtle border-t-signal" />
              Starting sign-in session…
            </div>
          )}

          {/* URL ready: show the open-button. For paste-types we also collect
              the callback code; for display-types we just show the upstream
              one-time code and wait for the CLI to detect success. */}
          {(oauthState === "awaiting_code" || oauthState === "submitted") && oauthUrl && (
            <>
              <a
                href={oauthUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl bg-signal px-4 py-3 text-[0.9375rem] font-medium text-white hover:opacity-90 transition-opacity"
              >
                <Icon className="size-4" />
                Open {type} sign-in →
              </a>

              {showsDisplayCode && oauthDisplayCode && (
                <div className="rounded-xl border border-border-subtle bg-surface-card/60 px-4 py-3 text-left">
                  <p className="mb-1 text-[0.75rem] font-medium uppercase tracking-[0.08em] text-ink-muted">
                    Verification code
                  </p>
                  <p className="font-mono text-[1.125rem] tracking-[0.2em] text-ink">{oauthDisplayCode}</p>
                  <p className="mt-2 text-[0.75rem] text-ink-muted">
                    Confirm this code matches what's shown on the sign-in page, then approve.
                  </p>
                </div>
              )}

              {wantsPasteCode && (
                <div className="flex flex-col gap-2 text-left">
                  <label className="text-[0.75rem] font-medium uppercase tracking-[0.08em] text-ink-muted">
                    Paste the code from the browser
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={callbackCode}
                    onChange={(e) => onCallbackCodeChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && callbackCode.trim()) onSubmitCallbackCode(); }}
                    placeholder={type === "gemini" ? "4/0A…#…" : "callback code"}
                    className="rounded-xl border border-border-subtle bg-surface-card px-4 py-3 font-mono text-[0.8125rem] text-ink outline-none focus:border-signal"
                  />
                  <Button
                    className="mt-1 bg-signal text-white"
                    isDisabled={busy || !callbackCode.trim() || oauthState === "submitted"}
                    onPress={onSubmitCallbackCode}
                  >
                    {(busy || oauthState === "submitted") && <Spinner size="sm" />}
                    {oauthState === "submitted" ? "Verifying…" : "Submit code"}
                  </Button>
                </div>
              )}

              {!wantsPasteCode && oauthPolling && (
                <div className="flex items-center justify-center gap-2 text-[0.8125rem] text-ink-muted">
                  <div className="size-3.5 animate-spin rounded-full border-2 border-border-subtle border-t-signal" />
                  Waiting for sign-in — this page updates automatically.
                </div>
              )}
            </>
          )}

          {/* Terminal failure — let the user start over without going back. */}
          {terminal && oauthState !== "ok" && (
            <Button
              className="mt-2 bg-signal text-white"
              isDisabled={busy}
              onPress={async () => { await onCancelOAuth(); onStartOAuth(); }}
            >
              Try again
            </Button>
          )}
        </div>
      ) : (
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-col gap-2 text-left">
            <div className="flex items-center justify-between">
              <label className="text-[0.75rem] font-medium uppercase tracking-[0.08em] text-ink-muted">
                {label}
              </label>
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[0.75rem] text-signal hover:underline"
              >
                Get a key →
              </a>
            </div>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSubmitKey(); }}
              placeholder={placeholder}
              className="rounded-xl border border-border-subtle bg-surface-card px-4 py-3 font-mono text-[0.875rem] text-ink outline-none focus:border-signal"
            />
            {!isProvider && (
              <p className="text-[0.75rem] text-ink-muted">
                Stored in <code className="rounded bg-surface-raised px-1">/etc/5dive/connectors/{type}.env</code>.
              </p>
            )}
          </div>

          <Button
            className="mt-3 bg-signal text-white"
            isDisabled={busy || !apiKey.trim()}
            onPress={onSubmitKey}
          >
            {busy && <Spinner size="sm" />}
            Continue
          </Button>
        </div>
      )}

      {error && <p className="mt-4 text-[0.8125rem] text-red-500">{error}</p>}
    </motion.div>
  );
}

/* -------------------------------------------------------------------- */
/*  Step 6 — Channel                                                    */
/* -------------------------------------------------------------------- */

function ChannelStep({
  type,
  selected,
  onSelect,
  onContinue,
}: {
  type: AgentType;
  selected: ChannelId;
  onSelect: (v: ChannelId) => void;
  onContinue: () => void;
}) {
  const options: Array<{
    id: ChannelId;
    name: string;
    description: string;
    Icon: IconComponent | null;
  }> = [
    { id: "none",     name: "No channel",  description: "Talk to the agent from the CLI or this dashboard.", Icon: null },
    { id: "telegram", name: "Telegram",    description: "Message the agent from your phone via a Telegram bot.", Icon: CHANNEL_ICON.telegram },
    { id: "discord",  name: "Discord",     description: "Wire the agent into a Discord channel.", Icon: CHANNEL_ICON.discord },
  ];

  return (
    <StepShell
      eyebrow={`${type} · channel`}
      title="How do you want to reach it?"
      subtitle="Pick a chat channel — or skip and just use the dashboard."
      maxWidth="max-w-2xl"
    >
      <div className="mb-8 flex w-full flex-col gap-3">
        {options.map((opt, i) => {
          const isSelected = selected === opt.id;
          return (
            <motion.button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              whileHover={{ y: -1 }}
              className={`flex w-full items-center gap-4 rounded-2xl p-5 text-left transition-colors ${
                isSelected
                  ? "bg-signal-soft ring-1 ring-inset ring-signal/40"
                  : "bg-surface-card/60 hover:bg-surface-card"
              }`}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-zinc-900 ring-1 ring-black/5">
                {opt.Icon ? <opt.Icon className="size-5" /> : <div className="size-2 rounded-full bg-zinc-300" />}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <span className={`text-[0.9375rem] font-semibold ${isSelected ? "text-signal" : "text-ink"}`}>
                  {opt.name}
                </span>
                <span className="text-[0.8125rem] text-ink-secondary">{opt.description}</span>
              </div>
              <div className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                isSelected ? "border-signal bg-signal" : "border-border-hard"
              }`}>
                {isSelected && <Check className="size-3 text-white" />}
              </div>
            </motion.button>
          );
        })}
      </div>

      <Button className="bg-signal text-white" onPress={onContinue}>
        {selected === "telegram" ? "Next" : "Create agent"}
      </Button>
    </StepShell>
  );
}

/* -------------------------------------------------------------------- */
/*  Step 7 — Telegram token                                             */
/* -------------------------------------------------------------------- */

// Channel-aware token step. Telegram and Discord both need a bot token,
// but the setup path + token shape + docs URL differ. Same shell, different
// copy + placeholder + link.
function TokenStep({
  channel,
  value,
  onChange,
  error,
  onContinue,
}: {
  channel: "telegram" | "discord";
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  onContinue: () => void;
}) {
  const Icon = CHANNEL_ICON[channel];
  const copy = channel === "telegram"
    ? {
        eyebrow: "Telegram",
        title: "Paste your bot token",
        intro: (
          <>
            Create a bot with{" "}
            <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer"
              className="text-signal underline-offset-2 hover:underline">@BotFather</a>
            , then paste the token it gives you.
          </>
        ),
        placeholder: "1234567890:ABC…",
      }
    : {
        eyebrow: "Discord",
        title: "Paste your bot token",
        intro: (
          <>
            Create an application in the{" "}
            <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer"
              className="text-signal underline-offset-2 hover:underline">Developer Portal</a>
            , add a Bot to it, then copy the bot token.
          </>
        ),
        placeholder: "MTIz…",
      };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="flex w-full max-w-md flex-col items-center text-center"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative mb-6"
      >
        <div className="pointer-events-none absolute inset-0 -z-10 scale-150 rounded-full bg-signal/10 blur-3xl" />
        <div className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] ring-1 ring-black/5">
          {Icon ? <Icon className="size-8" /> : null}
        </div>
      </motion.div>

      <p className="mb-2 text-[0.75rem] font-semibold uppercase tracking-[0.15em] text-signal">
        {copy.eyebrow}
      </p>
      <h1 className="mb-3 text-3xl font-semibold tracking-[-0.025em] text-ink sm:text-4xl">
        {copy.title}
      </h1>
      <p className="mb-8 max-w-sm text-[0.9375rem] text-ink-secondary">
        {copy.intro}
      </p>

      <div className="mb-6 flex w-full flex-col gap-2 text-left">
        <label
          htmlFor="channel-token"
          className="text-[0.75rem] font-medium uppercase tracking-[0.08em] text-ink-muted"
        >
          Bot token
        </label>
        <input
          id="channel-token"
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onContinue(); }}
          placeholder={copy.placeholder}
          className="rounded-xl border border-border-subtle bg-surface-card px-4 py-3 font-mono text-[0.8125rem] text-ink outline-none focus:border-signal"
        />
        {error && <p className="text-[0.75rem] text-red-500">{error}</p>}
      </div>

      <Button
        className="bg-signal text-white"
        isDisabled={!value.trim()}
        onPress={onContinue}
      >
        Create agent
      </Button>
    </motion.div>
  );
}

/* -------------------------------------------------------------------- */
/*  Step 8 — Creating                                                   */
/* -------------------------------------------------------------------- */

function CreatingStep({
  name,
  busy,
  error,
  channelSelected,
  onRetry,
  onEditChannel,
  onEditIsolation,
}: {
  name: string;
  busy: boolean;
  error: string | null;
  channelSelected: boolean;
  onRetry: () => void;
  onEditChannel: () => void;
  onEditIsolation: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="flex w-full max-w-md flex-col items-center pt-24 text-center"
    >
      {busy && !error ? (
        <>
          <Spinner size="lg" />
          <p className="mt-6 text-[1rem] text-ink">Creating {name}…</p>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">This usually takes a few seconds.</p>
        </>
      ) : error ? (
        // Failure surface — keep the user on this step with their inputs
        // intact (state lives in NewAgentFlow). Offer same-form retry plus
        // shortcuts back to the two steps that most often contain the
        // problem (bad channel token / wrong isolation level).
        <div className="flex w-full flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <span className="text-2xl leading-none">!</span>
          </div>
          <p className="text-[1rem] font-medium text-ink">Couldn't create {name}</p>
          <p className="max-w-sm text-[0.8125rem] text-ink-secondary">{error}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button className="bg-signal text-white" onPress={onRetry}>
              Retry
            </Button>
            {channelSelected && (
              <Button className="bg-surface-card text-ink" onPress={onEditChannel}>
                Edit channel
              </Button>
            )}
            <Button className="bg-surface-card text-ink" onPress={onEditIsolation}>
              Edit settings
            </Button>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}
