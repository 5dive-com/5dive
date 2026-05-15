import { useState, useEffect } from "react";
import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import { ChevronDown } from "lucide-react";
import { TYPE_ICON, CHANNEL_ICON } from "./icons";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const TYPES = ["claude", "codex", "gemini", "hermes", "openclaw", "opencode"] as const;
type AgentType = typeof TYPES[number];

const ISOLATION_OPTIONS = [
  { value: "admin",     label: "Admin",     desc: "Full server access" },
  { value: "standard",  label: "Standard",  desc: "Read-only /home/claude" },
  { value: "sandboxed", label: "Sandboxed", desc: "Own home dir only" },
] as const;

const OAUTH_TYPES = new Set<AgentType>(["claude"]);
const CHANNEL_SUPPORTED = new Set<AgentType>(["claude", "hermes", "openclaw"]);
const PROVIDER_TYPES = new Set<AgentType>(["hermes", "openclaw"]);

const PROVIDERS = [
  "openrouter", "anthropic", "openai", "google", "deepseek",
  "qwen", "nous", "minimax", "moonshot", "huggingface", "zai",
];

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

type Step = "config" | "auth" | "creating";

export function CreateAgentModal({ onClose, onCreated }: Props) {
  // Step 1 state
  const [name, setName] = useState("");
  const [type, setType] = useState<AgentType>("claude");
  const [isolation, setIsolation] = useState("admin");
  const [channels, setChannels] = useState("none");
  const [telegramToken, setTelegramToken] = useState("");
  // Advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [workdir, setWorkdir] = useState("");

  // Step 2 state
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState("openrouter");
  const [authNeeded, setAuthNeeded] = useState(false);
  // OAuth
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthPolling, setOauthPolling] = useState(false);

  const [step, setStep] = useState<Step>("config");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modalState = useOverlayState({ isOpen: true, onOpenChange: (open) => { if (!open) onClose(); } });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/auth/${type}`)
      .then(r => r.json())
      .then((j: { ok: boolean; data?: Record<string, string> }) => {
        if (cancelled) return;
        const status = j.ok ? (j.data?.[type] ?? "needs_login") : "needs_login";
        setAuthNeeded(status !== "ok");
      })
      .catch(() => {});
    if (!CHANNEL_SUPPORTED.has(type)) setChannels("none");
    return () => { cancelled = true; };
  }, [type]);

  const handleNext = async () => {
    setError(null);
    if (!name.trim()) { setError("Name is required"); return; }
    if (!/^[a-z][a-z0-9-]{0,15}$/.test(name.trim())) {
      setError("Name must be lowercase letters/digits/hyphens, start with a letter, max 16 chars");
      return;
    }
    if (authNeeded) { setStep("auth"); return; }
    await doCreate();
  };

  const startOAuth = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${type}/start`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) {
        setError(typeof j.error === "string" ? j.error : (j.error?.message ?? "Failed to start login"));
        return;
      }
      setOauthSessionId(j.data.sessionId);
      setOauthPolling(true);
      pollOAuth(j.data.sessionId);
    } finally {
      setBusy(false);
    }
  };

  const pollOAuth = (sessionId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/${type}/poll/${sessionId}`);
        const j = await res.json();
        if (!j.ok) return;
        const { state, url } = j.data as { state: string; url: string | null };
        if (url) setOauthUrl(url);
        if (state === "complete") {
          clearInterval(interval);
          setOauthPolling(false);
          await doCreate();
        }
        if (state === "error") {
          clearInterval(interval);
          setOauthPolling(false);
          setError("Authentication failed");
        }
      } catch { /* keep polling */ }
    }, 2000);
  };

  const handleAuthAndCreate = async () => {
    setError(null);
    if (!apiKey.trim()) { setError("API key is required"); return; }
    setBusy(true);
    setStep("creating");
    try {
      const authRes = await fetch(`/api/auth/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          ...(PROVIDER_TYPES.has(type) ? { provider } : {}),
        }),
      });
      const authJ = await authRes.json();
      if (!authJ.ok) {
        const e = authJ.error;
        setError(typeof e === "string" ? e : (e?.message ?? "Authentication failed"));
        setStep("auth");
        setBusy(false);
        return;
      }
      await doCreate();
    } catch {
      setError("Network error");
      setStep("auth");
      setBusy(false);
    }
  };

  const doCreate = async () => {
    setBusy(true);
    setStep("creating");
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          isolation,
          channels,
          telegramToken,
          ...(workdir.trim() ? { workdir: workdir.trim() } : {}),
        }),
      });
      const j = await res.json();
      if (j.ok) {
        onCreated();
      } else {
        const e = j.error;
        setError(typeof e === "string" ? e : (e?.message ?? "Failed to create agent"));
        setStep(authNeeded ? "auth" : "config");
      }
    } catch {
      setError("Network error");
      setStep("config");
    } finally {
      setBusy(false);
    }
  };

  const isProviderType = PROVIDER_TYPES.has(type);
  const effectiveKeyLabel = isProviderType
    ? (PROVIDER_KEY_LABELS[provider] ?? "API key")
    : AUTH_HELP[type].label;
  const effectiveKeyPlaceholder = isProviderType
    ? (PROVIDER_KEY_PLACEHOLDERS[provider] ?? "sk-…")
    : AUTH_HELP[type].placeholder;
  const effectiveDocsUrl = isProviderType
    ? (PROVIDER_DOCS[provider] ?? "#")
    : AUTH_HELP[type].docsUrl;

  return (
    <Modal state={modalState}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center" className="sm:max-w-[480px]">
          <Modal.Dialog className="p-0">

            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border-subtle px-6 py-4">
              {step !== "config" && (
                <button
                  onClick={() => { setStep("config"); setError(null); }}
                  className="text-ink-muted hover:text-ink"
                  disabled={step === "creating"}
                >
                  ←
                </button>
              )}
              <div>
                <h2 className="text-[1rem] font-semibold tracking-tight text-ink">
                  {step === "config" && "New agent"}
                  {step === "auth" && `Connect ${type}`}
                  {step === "creating" && `Creating ${name}…`}
                </h2>
                {step !== "creating" && (
                  <p className="text-[0.75rem] text-ink-muted">
                    {step === "config" && (authNeeded ? "Step 1 of 2 — configure" : "Configure your agent")}
                    {step === "auth" && `Step 2 of 2 — authenticate ${type}`}
                  </p>
                )}
              </div>
              {authNeeded && step !== "creating" && (
                <div className="ml-auto flex gap-1.5">
                  <div className={`size-1.5 rounded-full ${step === "config" ? "bg-signal" : "bg-border-hard"}`} />
                  <div className={`size-1.5 rounded-full ${step === "auth" ? "bg-signal" : "bg-border-hard"}`} />
                </div>
              )}
            </div>

            {/* Step 1: Config */}
            {step === "config" && (
              <div className="flex flex-col gap-5 px-6 py-5">
                {/* Name */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.8125rem] font-medium text-ink">Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-agent"
                    autoFocus
                    className="rounded-xl border border-border-subtle bg-surface-card px-3.5 py-2.5 text-[0.875rem] text-ink outline-none focus:border-signal"
                  />
                  <p className="text-[0.7rem] text-ink-muted">Lowercase, letters/digits/hyphens, starts with a letter, max 16 chars</p>
                </div>

                {/* Type */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[0.8125rem] font-medium text-ink">Type</span>
                  <div className="grid grid-cols-3 gap-2">
                    {TYPES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setType(t)}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[0.8125rem] font-medium transition-colors ${
                          type === t
                            ? "border-signal bg-signal-soft text-signal"
                            : "border-border-subtle text-ink-secondary hover:bg-surface-raised"
                        }`}
                      >
                        {(() => { const I = TYPE_ICON[t] ?? TYPE_ICON.claude; return <I className="size-3.5 shrink-0" />; })()}
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Isolation */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[0.8125rem] font-medium text-ink">Isolation</span>
                  <div className="grid grid-cols-3 gap-2">
                    {ISOLATION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setIsolation(opt.value)}
                        className={`flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          isolation === opt.value
                            ? "border-signal bg-signal-soft"
                            : "border-border-subtle hover:bg-surface-raised"
                        }`}
                      >
                        <span className={`text-[0.8125rem] font-medium ${isolation === opt.value ? "text-signal" : "text-ink"}`}>
                          {opt.label}
                        </span>
                        <span className="text-[0.6875rem] text-ink-muted">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Channel */}
                {CHANNEL_SUPPORTED.has(type) && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.8125rem] font-medium text-ink">Channel</span>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: "none",     label: "None",     Icon: null },
                        { value: "telegram", label: "Telegram", Icon: CHANNEL_ICON.telegram },
                        { value: "discord",  label: "Discord",  Icon: CHANNEL_ICON.discord },
                      ] as const).map(({ value, label, Icon }) => (
                        <button
                          key={value}
                          onClick={() => setChannels(value)}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[0.8125rem] font-medium transition-colors ${
                            channels === value
                              ? "border-signal bg-signal-soft text-signal"
                              : "border-border-subtle text-ink-secondary hover:bg-surface-raised"
                          }`}
                        >
                          {Icon ? <Icon className="size-3.5 shrink-0" /> : <span className="size-3.5" />}
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {channels === "telegram" && CHANNEL_SUPPORTED.has(type) && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.8125rem] font-medium text-ink">Telegram bot token</label>
                    <input
                      value={telegramToken}
                      onChange={(e) => setTelegramToken(e.target.value)}
                      placeholder="1234567890:ABC…"
                      className="rounded-xl border border-border-subtle bg-surface-card px-3.5 py-2.5 font-mono text-[0.8125rem] text-ink outline-none focus:border-signal"
                    />
                  </div>
                )}

                {/* Advanced toggle */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 self-start text-[0.8125rem] text-ink-muted hover:text-ink"
                >
                  <ChevronDown className={`size-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                  Advanced options
                </button>

                {showAdvanced && (
                  <div className="flex flex-col gap-4 rounded-xl bg-surface-raised p-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.8125rem] font-medium text-ink">Working directory</label>
                      <input
                        value={workdir}
                        onChange={(e) => setWorkdir(e.target.value)}
                        placeholder="/home/claude/projects"
                        className="rounded-xl border border-border-subtle bg-surface-card px-3.5 py-2.5 font-mono text-[0.8125rem] text-ink outline-none focus:border-signal"
                      />
                      <p className="text-[0.7rem] text-ink-muted">Default: /home/claude/projects</p>
                    </div>
                  </div>
                )}

                {error && <p className="text-[0.8125rem] text-red-500">{error}</p>}
              </div>
            )}

            {/* Step 2: Auth */}
            {step === "auth" && (
              <div className="flex flex-col gap-5 px-6 py-5">
                <div className="flex items-center gap-3 rounded-xl bg-surface-raised p-4">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-surface-card text-ink-secondary">
                    {(() => { const I = TYPE_ICON[type] ?? TYPE_ICON.claude; return <I className="size-5" />; })()}
                  </div>
                  <div>
                    <p className="text-[0.875rem] font-medium text-ink capitalize">{type}</p>
                    <p className="text-[0.75rem] text-ink-secondary">Not yet authenticated on this machine</p>
                  </div>
                </div>

                {OAUTH_TYPES.has(type) ? (
                  <div className="flex flex-col gap-3">
                    {!oauthUrl ? (
                      <p className="text-[0.8125rem] text-ink-secondary">
                        Sign in with your Claude account. A browser window will open.
                      </p>
                    ) : (
                      <>
                        <p className="text-[0.8125rem] text-ink-secondary">
                          Sign in, then return here — this page updates automatically.
                        </p>
                        <a
                          href={oauthUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 rounded-xl border border-signal bg-signal-soft px-4 py-3 text-[0.875rem] font-medium text-signal hover:bg-signal hover:text-white transition-colors"
                        >
                          {(() => { const I = TYPE_ICON[type]; return I ? <I className="size-4" /> : null; })()}
                          Open Claude sign-in →
                        </a>
                        {oauthPolling && (
                          <div className="flex items-center gap-2 text-[0.8125rem] text-ink-muted">
                            <div className="size-3.5 animate-spin rounded-full border-2 border-border-subtle border-t-signal" />
                            Waiting for sign-in…
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {/* Provider selector for hermes/openclaw */}
                    {isProviderType && (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[0.8125rem] font-medium text-ink">Provider</label>
                        <div className="relative">
                          <select
                            value={provider}
                            onChange={(e) => setProvider(e.target.value)}
                            className="w-full appearance-none rounded-xl border border-border-subtle bg-surface-card px-3.5 py-2.5 pr-9 text-[0.875rem] text-ink outline-none focus:border-signal"
                          >
                            {PROVIDERS.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                        </div>
                      </div>
                    )}

                    {/* API key input */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[0.8125rem] font-medium text-ink">{effectiveKeyLabel}</label>
                        <a
                          href={effectiveDocsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.75rem] text-signal hover:underline"
                        >
                          Get key →
                        </a>
                      </div>
                      <input
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={effectiveKeyPlaceholder}
                        type="password"
                        autoFocus
                        className="rounded-xl border border-border-subtle bg-surface-card px-3.5 py-2.5 font-mono text-[0.8125rem] text-ink outline-none focus:border-signal"
                        onKeyDown={(e) => { if (e.key === "Enter") void handleAuthAndCreate(); }}
                      />
                      {!isProviderType && (
                        <p className="text-[0.75rem] text-ink-muted">
                          Stored in <code className="rounded bg-surface-raised px-1">/etc/5dive/connectors/{type}.env</code>
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {error && <p className="text-[0.8125rem] text-red-500">{error}</p>}
              </div>
            )}

            {/* Creating */}
            {step === "creating" && (
              <div className="flex flex-col items-center gap-3 px-6 py-10">
                <Spinner size="lg" />
                <p className="text-[0.875rem] text-ink-secondary">Creating {name}…</p>
              </div>
            )}

            {/* Footer */}
            {step !== "creating" && (
              <div className="flex justify-end gap-2 border-t border-border-subtle px-6 py-4">
                <Button variant="ghost" className="text-ink-secondary" onPress={onClose}>
                  Cancel
                </Button>
                {step === "config" && (
                  <Button className="bg-signal text-white" onPress={() => void handleNext()}>
                    {authNeeded ? "Next →" : "Create agent"}
                  </Button>
                )}
                {step === "auth" && OAUTH_TYPES.has(type) && !oauthUrl && (
                  <Button className="bg-signal text-white" isDisabled={busy} onPress={() => void startOAuth()}>
                    {busy ? <Spinner size="sm" /> : null}
                    Sign in with Claude
                  </Button>
                )}
                {step === "auth" && !OAUTH_TYPES.has(type) && (
                  <Button
                    className="bg-signal text-white"
                    isDisabled={busy || !apiKey.trim()}
                    onPress={() => void handleAuthAndCreate()}
                  >
                    {busy ? <Spinner size="sm" /> : null}
                    Authenticate & create
                  </Button>
                )}
              </div>
            )}

          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
