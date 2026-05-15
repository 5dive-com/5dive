import { useCallback, useSyncExternalStore } from "react";
import { Bot, Users, Activity, ChevronLeft, Plus } from "lucide-react";
import { LogoMark } from "./Logo";
import type { Page } from "../types";

const STORAGE_KEY = "sidebar-collapsed";
const SYNC_EVENT = "sidebar-collapsed-sync";

function useSidebarCollapsed() {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener(SYNC_EVENT, cb);
    return () => window.removeEventListener(SYNC_EVENT, cb);
  }, []);

  const collapsed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(STORAGE_KEY) === "true",
    () => false,
  );

  const toggle = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, String(!collapsed));
    window.dispatchEvent(new Event(SYNC_EVENT));
  }, [collapsed]);

  return [collapsed, toggle] as const;
}

const NAV_ITEMS: { id: Page; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "agents",   label: "Agents",   Icon: Bot },
  { id: "accounts", label: "Accounts", Icon: Users },
  { id: "health",   label: "Health",   Icon: Activity },
];

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  onNewAgent: () => void;
}

export function Sidebar({ page, onNavigate, onNewAgent }: Props) {
  const [collapsed, toggle] = useSidebarCollapsed();

  return (
    <aside
      className={`relative flex h-screen shrink-0 flex-col border-r border-border-subtle bg-surface-card transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-4 border-b border-border-subtle shrink-0">
        <LogoMark className="size-7 shrink-0" />
        {!collapsed && (
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span className="truncate text-[0.9375rem] font-semibold tracking-tight text-ink">
              5dive
            </span>
            <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[0.625rem] font-medium text-ink-muted">
              local
            </span>
          </div>
        )}
      </div>

      {/* New agent button */}
      <div className={`px-3 pt-4 pb-2 shrink-0 ${collapsed ? "flex justify-center" : ""}`}>
        {collapsed ? (
          <button
            onClick={onNewAgent}
            title="New agent"
            className="flex size-8 items-center justify-center rounded-lg bg-signal text-white hover:opacity-90"
          >
            <Plus className="size-4" />
          </button>
        ) : (
          <button
            onClick={onNewAgent}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-signal px-3 py-2 text-[0.8125rem] font-medium text-white hover:opacity-90"
          >
            <Plus className="size-3.5" /> New agent
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2 pt-1 overflow-y-auto">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = page === id || (page.startsWith(id));
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-[0.875rem] font-medium transition-colors ${
                active
                  ? "bg-signal-soft text-signal"
                  : "text-ink-secondary hover:bg-surface-raised hover:text-ink"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="shrink-0 p-2 border-t border-border-subtle">
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center justify-center rounded-lg py-1.5 text-ink-muted hover:bg-surface-raised hover:text-ink"
        >
          <ChevronLeft
            className={`size-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
          />
        </button>
      </div>
    </aside>
  );
}
