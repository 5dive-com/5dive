export interface Agent {
  name: string;
  type: string;
  status: "active" | "inactive" | "failed" | "activating" | "deactivating";
  channels: string | null;
  isolation: string | null;
  workdir: string | null;
  authProfile: string | null;
  createdAt: string | null;
}

export interface Account {
  name: string;
  types: string[];
  agentCount: number;
}

export interface AccountDetail {
  name: string;
  types: Record<string, { keys: string[] }>;
  agents: string[];
}

export interface DoctorCheck {
  name: string;
  category: string;
  severity: "ok" | "warn" | "error";
  message?: string;
  fixable?: boolean;
}

export interface DoctorResult {
  summary: { total: number; passed: number; warnings: number; errors: number };
  checks: DoctorCheck[];
}

export type Page = "agents" | "accounts" | "health";
