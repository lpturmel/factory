// Types for the files described in docs/state-contract.md (version 1), plus the
// reader's API responses. Shared by the browser app and server/reader.ts, so this
// file must stay free of DOM and Node imports.

export type Stage =
  | "intake" | "needs-info" | "spec" | "build" | "gate" | "review"
  | "approve" | "merging" | "needs-human" | "merged" | "rejected";

export const ACTIVE_STAGES: readonly Stage[] = ["intake", "spec", "build", "gate", "review", "approve", "merging"];
export const FLOW_STAGES: readonly Stage[] = ["intake", "spec", "build", "gate", "review", "approve", "merging", "merged"];

export type Risk = "low" | "medium" | "high";
export type Verdict = "PASS" | "FAIL" | "CHANGES";

export interface RegistryProject {
  name: string;
  path: string;
  backlog: "local" | "github";
  merge: "pr" | "local";
  repo: string | null;
  registered_at: string;
}

export interface RegistryFile {
  version: number;
  projects: RegistryProject[];
}

export interface Reviewer {
  name: string;
  model: string;
  model_id?: string;
}

export interface HistoryEntry {
  stage: Stage;
  at: string;
  round: number;
  note: string;
}

export interface JobCost {
  usd: number;
  by_agent?: Record<string, number>;
  updated_at?: string;
}

export interface JobJson {
  version: number;
  id: string;
  title: string;
  stage: Stage;
  waiting_on: "author" | "human" | null;
  note: string;
  issue: {
    source: "github" | "local";
    ref: string;
    url: string | null;
    file: string | null;
    author: string | null;
  };
  risk: Risk | null;
  surfaces: string[];
  models?: Record<string, string>;
  reviewers: Reviewer[];
  round: number;
  max_rounds: number;
  branch: string | null;
  pr: { number: number; url: string; draft: boolean } | null;
  verdicts: {
    intake?: string | null;
    gate?: Record<string, "PASS" | "FAIL">;
    review?: Record<string, Record<string, "PASS" | "CHANGES">>;
    approve?: Record<string, "APPROVE" | "ESCALATE">;
    merge_gate?: Record<string, "PASS" | "FAIL">;
  };
  cost: JobCost | null;
  created_at: string;
  updated_at: string;
  stage_entered_at: string;
  history: HistoryEntry[];
}

/** The parts of <path>/factory/config.json the dashboard reads. */
export interface ConfigSubset {
  name?: string;
  backlog?: "local" | "github";
  merge?: "pr" | "local";
  concurrency?: number;
  max_rounds?: number;
  reviewers?: { name: string }[];
}

/** Optional heartbeat, see DESIGN.md Q1. Read if present, never required. */
export interface RunFile {
  pid?: number;
  started_at?: string;
  heartbeat_at?: string;
  stopped_at?: string | null;
  concurrency?: number;
}

// ---------- reader API ----------

export interface ApiRegistryProject extends RegistryProject {
  exists: boolean;
}

export interface ApiRegistry {
  registryPath: string;
  projects: ApiRegistryProject[];
}

/** A job as the factory endpoint returns it: job.json plus what the overview needs. */
export interface ApiJob extends JobJson {
  /** Summary bullets of the file that explains why this job needs attention, if it does. */
  attentionSummary?: string[];
}

export type FactoryStatus = "ok" | "missing" | "unreadable";

export interface ApiFactory {
  name: string;
  path: string;
  /** `path` with the home folder shown as ~. */
  displayPath: string;
  status: FactoryStatus;
  error: string | null;
  backlog: "local" | "github";
  merge: "pr" | "local";
  repo: string | null;
  config: ConfigSubset | null;
  run: RunFile | null;
  jobs: ApiJob[];
  readErrors: { id: string; message: string }[];
  readAt: string;
}

export interface ApiJobFile {
  name: string;
  summary: string[];
  verdicts: Record<string, string>;
  mtime: string;
  size: number;
}

export interface ApiJobDetail {
  factory: string;
  path: string;
  job: JobJson;
  files: ApiJobFile[];
}

export interface ApiFileContent {
  name: string;
  kind: "md" | "log";
  text: string;
  truncated: boolean;
}

export interface ApiLogTail {
  name: string;
  lines: string[];
}

export type ApiEvent =
  | { type: "hello" }
  | { type: "registry" }
  | { type: "factory"; name: string; jobId?: string };
