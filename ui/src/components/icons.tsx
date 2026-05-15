export {
  Bot,
  Code2,
  Sparkles,
  Zap,
  Bird,
  Wrench,
  MoreVertical,
  Play,
  Square,
  RotateCw,
  Trash2,
  ArrowLeft,
  RefreshCw,
  Terminal,
  Send,
  BarChart2,
  Plus,
  ExternalLink,
  Copy,
  Users,
  Activity,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  X,
  Info,
} from "lucide-react";

import type { ComponentType, SVGProps } from "react";
import {
  ClaudeIcon,
  CodexIcon,
  GeminiIcon,
  HermesIcon,
  OpenClawIcon,
  OpenCodeIcon,
  TelegramIcon,
  DiscordIcon,
} from "./brand-icons";

type IconComponent = ComponentType<{ className?: string } & SVGProps<SVGSVGElement>>;

export const TYPE_ICON: Record<string, IconComponent> = {
  claude:   ClaudeIcon,
  codex:    CodexIcon,
  gemini:   GeminiIcon,
  hermes:   HermesIcon,
  openclaw: OpenClawIcon,
  opencode: OpenCodeIcon,
};

export const CHANNEL_ICON: Record<string, IconComponent> = {
  telegram: TelegramIcon,
  discord:  DiscordIcon,
};
