// Pure derivations from the state contract (DESIGN.md §8.7). No DOM, no Node.
import { ACTIVE_STAGES, type ApiFactory, type ApiJob, type ApiJobDetail, type JobJson, type Stage } from "./contract.ts";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** A factory with active jobs but no job write for this long is shown as stopped. */
export const STOPPED_AFTER = 15 * MIN;
/** A heartbeat (factory/run.json) older than this no longer counts as running. */
export const HEARTBEAT_STALE = 2 * MIN;
/** Consecutive gate FAILs that count as "failing repeatedly". */
export const GATE_STREAK = 2;

export const ts = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

export const isActive = (stage: Stage): boolean => ACTIVE_STAGES.includes(stage);

// ---------- attention ----------

export type AttentionKind = "unreadable" | "max-rounds" | "escalated" | "gate" | "needs-info";
export const YOUR_MOVE: readonly AttentionKind[] = ["unreadable", "max-rounds", "escalated"];
export const ATTENTION_RANK: Record<AttentionKind, number> = {
  unreadable: 0, "max-rounds": 1, escalated: 2, gate: 3, "needs-info": 4,
};

const roundKeysDesc = (rec: Record<string, unknown> | undefined): number[] =>
  Object.keys(rec ?? {}).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => b - a);

/** Consecutive FAILs at the highest gated rounds. */
export function gateFailStreak(job: Pick<JobJson, "verdicts">): number {
  const gate = job.verdicts?.gate ?? {};
  let n = 0;
  for (const r of roundKeysDesc(gate)) {
    if (gate[String(r)] === "FAIL") n++;
    else break;
  }
  return n;
}

export function attentionKind(job: JobJson): AttentionKind | null {
  if (job.stage === "needs-human") {
    if (job.verdicts?.approve?.[String(job.round)] === "ESCALATE") return "escalated";
    if (job.round >= job.max_rounds) return "max-rounds";
    return "escalated";
  }
  if (job.stage === "needs-info") return "needs-info";
  if (isActive(job.stage) && gateFailStreak(job) >= GATE_STREAK) return "gate";
  return null;
}

export function attentionReason(job: JobJson, kind: AttentionKind): string {
  switch (kind) {
    case "max-rounds": return `Max rounds reached (${job.round}/${job.max_rounds})`;
    case "escalated":
      return job.verdicts?.approve?.[String(job.round)] === "ESCALATE" ? "Approver escalated" : job.note || "Needs a human";
    case "gate": return `Gate failed ${gateFailStreak(job)}× in a row`;
    case "needs-info": return "Waiting on the author";
    case "unreadable": return "Factory unreadable";
  }
}

/** The stage file that explains why the job needs attention (its Summary is quoted). */
export function attentionFile(job: JobJson, kind: AttentionKind): string | null {
  const r = job.round;
  switch (kind) {
    case "escalated": return job.verdicts?.approve?.[String(r)] ? `approve-${r}.md` : null;
    case "needs-info": return "intake.md";
    case "gate": {
      const failed = roundKeysDesc(job.verdicts?.gate).find((k) => job.verdicts?.gate?.[String(k)] === "FAIL");
      return failed ? `gate-${failed}.md` : null;
    }
    case "max-rounds": {
      const rev = job.verdicts?.review ?? {};
      for (const k of roundKeysDesc(rev)) {
        const changes = Object.entries(rev[String(k)] ?? {}).find(([, v]) => v === "CHANGES");
        if (changes) return `review-${k}-${changes[0]}.md`;
      }
      const failed = roundKeysDesc(job.verdicts?.gate).find((k) => job.verdicts?.gate?.[String(k)] === "FAIL");
      return failed ? `gate-${failed}.md` : null;
    }
    default: return null;
  }
}

export interface AttentionItem {
  kind: AttentionKind;
  factory: string;
  job: ApiJob | null;
  since: number;
  reason: string;
  question: string;
}

export function attentionItems(factories: readonly ApiFactory[], only?: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const f of factories) {
    if (only && f.name !== only) continue;
    if (f.status !== "ok") {
      items.push({ kind: "unreadable", factory: f.name, job: null, since: ts(f.readAt), reason: f.status === "missing" ? "Factory path not found" : "Factory unreadable", question: f.error ?? "" });
      continue;
    }
    for (const j of f.jobs) {
      const kind = attentionKind(j);
      if (!kind) continue;
      const question = j.attentionSummary?.length ? j.attentionSummary.join(" ") : j.note;
      items.push({ kind, factory: f.name, job: j, since: ts(j.stage_entered_at), reason: attentionReason(j, kind), question });
    }
  }
  return items.sort((a, b) => ATTENTION_RANK[a.kind] - ATTENTION_RANK[b.kind] || a.since - b.since);
}

// ---------- factory state ----------

export type RunState = "running" | "idle" | "stopped" | "error";

export function lastWrite(f: ApiFactory): number {
  const times = [...f.jobs.map((j) => ts(j.updated_at)), ts(f.run?.heartbeat_at)].filter((n) => !Number.isNaN(n));
  return times.length ? Math.max(...times) : NaN;
}

export function runState(f: ApiFactory, now: number): RunState {
  if (f.status !== "ok") return "error";
  if (f.run && !f.run.stopped_at && now - ts(f.run.heartbeat_at) < HEARTBEAT_STALE) return "running";
  const active = f.jobs.filter((j) => isActive(j.stage));
  if (!active.length) return "idle";
  const latest = Math.max(...active.map((j) => ts(j.updated_at)).filter((n) => !Number.isNaN(n)));
  return now - latest < STOPPED_AFTER ? "running" : "stopped";
}

export interface Throughput { days: number[]; merged: number; rejected: number }

/** Merged per day for the last 7 days (oldest first), from history entries. */
export function throughput7d(jobs: readonly JobJson[], now: number): Throughput {
  const days = [0, 0, 0, 0, 0, 0, 0];
  let merged = 0, rejected = 0;
  for (const j of jobs) {
    for (const h of j.history ?? []) {
      const age = now - ts(h.at);
      if (!(age >= 0 && age < 7 * DAY)) continue;
      if (h.stage === "merged") { merged++; days[6 - Math.floor(age / DAY)]++; }
      if (h.stage === "rejected") rejected++;
    }
  }
  return { days, merged, rejected };
}

/** API-equivalent spend of jobs touched in the last 7 days (approximate, see DESIGN.md §9). */
export function spend7d(jobs: readonly JobJson[], now: number): number {
  return jobs.reduce((s, j) => (now - ts(j.updated_at) < 7 * DAY ? s + (j.cost?.usd ?? 0) : s), 0);
}

export function openSpend(jobs: readonly JobJson[]): number {
  return jobs.reduce((s, j) => (j.stage !== "merged" && j.stage !== "rejected" ? s + (j.cost?.usd ?? 0) : s), 0);
}

export interface MedianJob { ms: number; usd: number; rounds: number; n: number }

export function medianMerged(jobs: readonly JobJson[], now: number): MedianJob | null {
  const done = jobs.filter((j) => j.stage === "merged" && now - ts(j.stage_entered_at) < 7 * DAY);
  if (!done.length) return null;
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return {
    ms: med(done.map((j) => ts(j.stage_entered_at) - ts(j.created_at))),
    usd: med(done.map((j) => j.cost?.usd ?? 0)),
    rounds: med(done.map((j) => j.round)),
    n: done.length,
  };
}

// ---------- phases (board columns) ----------

export type Phase = "you" | "queue" | "building" | "review" | "done";

export function phaseOf(stage: Stage): Phase {
  switch (stage) {
    case "needs-human": return "you";
    case "intake": case "needs-info": return "queue";
    case "spec": case "build": case "gate": return "building";
    case "review": case "approve": case "merging": return "review";
    default: return "done";
  }
}

export const PHASES: { key: Exclude<Phase, "done">; name: string; sub: string }[] = [
  { key: "you", name: "Needs you", sub: "needs-human" },
  { key: "queue", name: "Queue", sub: "intake · needs-info" },
  { key: "building", name: "Building", sub: "spec · build · gate" },
  { key: "review", name: "Review", sub: "review · approve · merging" },
];

// ---------- job detail ----------

/** `key` identifies the history entry (index + stage), so it is stable whatever `now` is. */
export interface StageSpan { key: string; stage: Stage; round: number; at: number; ms: number; note: string; current: boolean }

export function stageSpans(job: JobJson, now: number): StageSpan[] {
  const h = job.history ?? [];
  return h.map((e, i) => {
    const at = ts(e.at);
    const end = i + 1 < h.length ? ts(h[i + 1].at) : now;
    return { key: `${i}:${e.stage}`, stage: e.stage, round: e.round, at, ms: Math.max(0, end - at), note: e.note, current: i === h.length - 1 };
  });
}

/** A span's duration at `now`: fixed for finished spans, still growing for the current one. */
export const spanMs = (sp: StageSpan, now: number): number => (sp.current ? Math.max(0, now - sp.at) : sp.ms);

/** Structural equality of two job details (both come from JSON, so a string compare is exact). */
export function sameDetail(a: ApiJobDetail | null, b: ApiJobDetail): boolean {
  return a !== null && (a === b || JSON.stringify(a) === JSON.stringify(b));
}

export type Cell = "PASS" | "CHANGES" | "skip" | "running" | "pending";

export function reviewMatrix(job: JobJson): { reviewers: string[]; rounds: Cell[][] } {
  const reviewers = job.reviewers.map((r) => r.name);
  const rounds: Cell[][] = [];
  for (let r = 1; r <= job.round; r++) {
    const gate = job.verdicts?.gate?.[String(r)];
    const rev = job.verdicts?.review?.[String(r)] ?? {};
    rounds.push(reviewers.map((name) => {
      const v = rev[name];
      if (v) return v;
      if (gate === "FAIL") return "skip";
      if (r === job.round && job.stage === "review") return "running";
      if (r < job.round) return "skip";
      return "pending";
    }));
  }
  return { reviewers, rounds };
}

/** Which rounds a job's history covers, with a one-line outcome each. */
export interface RoundSummary { round: number; gate: "PASS" | "FAIL" | null; pass: number; changes: number; ms: number }

export function roundSummaries(job: JobJson, now: number): RoundSummary[] {
  const spans = stageSpans(job, now);
  const out: RoundSummary[] = [];
  for (let r = 1; r <= job.round; r++) {
    const rev = Object.values(job.verdicts?.review?.[String(r)] ?? {});
    out.push({
      round: r,
      gate: job.verdicts?.gate?.[String(r)] ?? null,
      pass: rev.filter((v) => v === "PASS").length,
      changes: rev.filter((v) => v === "CHANGES").length,
      ms: spans.filter((s) => s.round === r).reduce((a, s) => a + s.ms, 0),
    });
  }
  return out;
}

// ---------- formatting ----------

export const shortReviewer = (name: string): string => name.replace(/-reviewer$/, "");

export function ago(t: number, now: number): string {
  if (Number.isNaN(t)) return "—";
  const d = Math.max(0, now - t);
  if (d < MIN) return `${Math.round(d / 1000)}s`;
  if (d < HOUR) return `${Math.round(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ${Math.round((d % HOUR) / MIN)}m`;
  return `${Math.floor(d / DAY)}d ${Math.floor((d % DAY) / HOUR)}h`;
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < MIN) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.round(ms / MIN)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ${String(Math.round((ms % HOUR) / MIN)).padStart(2, "0")}m`;
  return `${Math.floor(ms / DAY)}d ${Math.floor((ms % DAY) / HOUR)}h`;
}

export const usd = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
