import { describe, expect, it } from "bun:test";
import type { ApiFactory, ApiJobDetail, JobJson } from "../src/shared/contract.ts";
import {
  DAY, MIN, attentionFile, attentionItems, attentionKind, gateFailStreak, phaseOf, reviewMatrix, runState, sameDetail, spanMs,
  stageSpans, throughput7d,
} from "../src/shared/derive.ts";
import { compareFiles, parseStageFile } from "../src/shared/parse.ts";

const NOW = Date.parse("2026-11-27T14:30:00Z");
const iso = (ago: number) => new Date(NOW - ago).toISOString();

function job(p: Partial<JobJson>): JobJson {
  return {
    version: 1, id: "gh-1", title: "t", stage: "build", waiting_on: null, note: "",
    issue: { source: "github", ref: "1", url: null, file: null, author: null },
    risk: "low", surfaces: [], reviewers: [{ name: "code-reviewer", model: "haiku" }], round: 1, max_rounds: 3,
    branch: null, pr: null, verdicts: {}, cost: { usd: 1 },
    created_at: iso(DAY), updated_at: iso(MIN), stage_entered_at: iso(MIN), history: [{ stage: "intake", at: iso(DAY), round: 0, note: "" }],
    ...p,
  };
}

function factory(jobs: JobJson[], p: Partial<ApiFactory> = {}): ApiFactory {
  return { name: "f", path: "/p", displayPath: "/p", status: "ok", error: null, backlog: "local", merge: "local", repo: null, config: { concurrency: 3 }, run: null, jobs, readErrors: [], readAt: iso(0), ...p };
}

describe("attentionKind", () => {
  it("escalated when the approver escalated this round", () => {
    expect(attentionKind(job({ stage: "needs-human", round: 2, verdicts: { approve: { 2: "ESCALATE" } } }))).toBe("escalated");
  });
  it("max-rounds when out of rounds without an escalation", () => {
    expect(attentionKind(job({ stage: "needs-human", round: 3, max_rounds: 3 }))).toBe("max-rounds");
  });
  it("needs-info waits on the author", () => {
    expect(attentionKind(job({ stage: "needs-info" }))).toBe("needs-info");
  });
  it("gate streak of two while active", () => {
    expect(attentionKind(job({ stage: "build", round: 3, verdicts: { gate: { 1: "FAIL", 2: "FAIL" } } }))).toBe("gate");
    expect(attentionKind(job({ stage: "build", round: 3, verdicts: { gate: { 1: "FAIL", 2: "PASS" } } }))).toBeNull();
  });
  it("nothing for merged jobs", () => {
    expect(attentionKind(job({ stage: "merged", verdicts: { gate: { 1: "FAIL", 2: "FAIL" } } }))).toBeNull();
  });
});

describe("gateFailStreak", () => {
  it("counts consecutive FAILs from the highest round, numerically", () => {
    expect(gateFailStreak(job({ verdicts: { gate: { 1: "PASS", 9: "FAIL", 10: "FAIL" } } }))).toBe(2);
    expect(gateFailStreak(job({ verdicts: { gate: { 1: "FAIL", 2: "PASS" } } }))).toBe(0);
  });
});

describe("attentionFile", () => {
  it("quotes the last CHANGES review for max-rounds", () => {
    const j = job({ stage: "needs-human", round: 3, verdicts: { review: { 1: { a: "CHANGES" }, 3: { "code-reviewer": "PASS", "gameplay-reviewer": "CHANGES" } } } });
    expect(attentionFile(j, "max-rounds")).toBe("review-3-gameplay-reviewer.md");
  });
  it("quotes approve-<round>.md for escalations", () => {
    expect(attentionFile(job({ stage: "needs-human", round: 2, verdicts: { approve: { 2: "ESCALATE" } } }), "escalated")).toBe("approve-2.md");
  });
});

describe("attentionItems", () => {
  it("ranks unreadable, max-rounds, escalated, gate, needs-info", () => {
    const items = attentionItems([
      factory([job({ id: "a", stage: "needs-info" }), job({ id: "b", stage: "needs-human", round: 3 }), job({ id: "c", stage: "needs-human", round: 1, verdicts: { approve: { 1: "ESCALATE" } } })]),
      factory([], { name: "gone", status: "missing", error: "gone" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["unreadable", "max-rounds", "escalated", "needs-info"]);
  });
});

describe("runState", () => {
  it("running with a fresh heartbeat", () => {
    expect(runState(factory([], { run: { heartbeat_at: iso(30_000) } }), NOW)).toBe("running");
  });
  it("stopped when active jobs have been quiet", () => {
    expect(runState(factory([job({ updated_at: iso(3 * DAY) })]), NOW)).toBe("stopped");
  });
  it("idle with no active jobs", () => {
    expect(runState(factory([job({ stage: "merged" })]), NOW)).toBe("idle");
  });
  it("error when unreadable", () => {
    expect(runState(factory([], { status: "missing" }), NOW)).toBe("error");
  });
});

describe("throughput7d", () => {
  it("buckets merges by day, oldest first", () => {
    const j = job({ stage: "merged", history: [{ stage: "intake", at: iso(DAY), round: 0, note: "" }, { stage: "merged", at: iso(MIN), round: 1, note: "" }] });
    const old = job({ stage: "merged", history: [{ stage: "merged", at: iso(8 * DAY), round: 1, note: "" }] });
    expect(throughput7d([j, old], NOW)).toEqual({ days: [0, 0, 0, 0, 0, 0, 1], merged: 1, rejected: 0 });
  });
});

describe("reviewMatrix", () => {
  it("marks gate-failed rounds as not run and live reviews as running", () => {
    const j = job({ stage: "review", round: 2, reviewers: [{ name: "a", model: "x" }, { name: "b", model: "y" }], verdicts: { gate: { 1: "FAIL", 2: "PASS" }, review: { 2: { a: "PASS" } } } });
    expect(reviewMatrix(j).rounds).toEqual([["skip", "skip"], ["PASS", "running"]]);
  });
});

describe("stageSpans", () => {
  const history: JobJson["history"] = [
    { stage: "intake", at: iso(DAY), round: 0, note: "" },
    { stage: "build", at: iso(50 * MIN), round: 1, note: "" },
    { stage: "gate", at: iso(40 * MIN), round: 1, note: "" },
    { stage: "build", at: iso(30 * MIN), round: 2, note: "" },
    { stage: "gate", at: iso(10 * MIN), round: 2, note: "" },
  ];
  it("keys and finished spans don't depend on now; only the current span's ms does", () => {
    const j = job({ history });
    const a = stageSpans(j, NOW);
    const b = stageSpans(j, NOW + 5 * MIN);
    expect(b.map((s) => s.key)).toEqual(a.map((s) => s.key));
    expect(b.slice(0, -1).map((s) => s.ms)).toEqual(a.slice(0, -1).map((s) => s.ms));
    expect(b.at(-1)!.ms).not.toBe(a.at(-1)!.ms);
    expect(b.at(-1)!.ms - a.at(-1)!.ms).toBe(5 * MIN);
  });
  it("keys are unique when a stage repeats across rounds", () => {
    const keys = stageSpans(job({ history }), NOW).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("spanMs", () => {
  it("grows the current span with now and keeps finished spans fixed", () => {
    const [done, cur] = stageSpans(job({ history: [{ stage: "build", at: iso(20 * MIN), round: 1, note: "" }, { stage: "gate", at: iso(5 * MIN), round: 1, note: "" }] }), 0);
    expect(spanMs(done, NOW)).toBe(15 * MIN);
    expect(spanMs(done, NOW + MIN)).toBe(15 * MIN);
    expect(spanMs(cur, NOW)).toBe(5 * MIN);
    expect(spanMs(cur, NOW + MIN)).toBe(6 * MIN);
  });
});

describe("sameDetail", () => {
  const detail = (): ApiJobDetail => ({
    factory: "f", path: "/p/factory/jobs/gh-1",
    job: job({ verdicts: { gate: { 1: "PASS" } } }),
    files: [{ name: "gate-1.log", summary: [], verdicts: {}, mtime: iso(MIN), size: 120 }],
  });
  it("true for a deep clone and a re-parsed JSON copy", () => {
    const d = detail();
    expect(sameDetail(d, structuredClone(d))).toBe(true);
    expect(sameDetail(d, JSON.parse(JSON.stringify(d)))).toBe(true);
  });
  it("false when history, a verdict, or a file's mtime/size changes", () => {
    const d = detail();
    const appended = detail(); appended.job.history.push({ stage: "build", at: iso(0), round: 1, note: "" });
    const verdict = detail(); verdict.job.verdicts.gate = { 1: "FAIL" };
    const mtime = detail(); mtime.files[0].mtime = iso(0);
    const size = detail(); size.files[0].size = 121;
    for (const other of [appended, verdict, mtime, size]) expect(sameDetail(d, other)).toBe(false);
  });
  it("false when there is no current detail", () => {
    expect(sameDetail(null, detail())).toBe(false);
  });
});

describe("phaseOf", () => {
  it("groups stages by who acts next", () => {
    expect(["needs-human", "needs-info", "gate", "merging", "merged"].map((s) => phaseOf(s as JobJson["stage"]))).toEqual(["you", "queue", "building", "review", "done"]);
  });
});

describe("parseStageFile", () => {
  it("reads Summary bullets and Verdict lines", () => {
    const p = parseStageFile("## Summary\n- one\n- two\n  continued\n\n## Verdict\nVerdict: CHANGES\nRisk: high\n\n## Detail\n- not a summary\n");
    expect(p.summary).toEqual(["one", "two continued"]);
    expect(p.verdicts).toEqual({ Verdict: "CHANGES", Risk: "high" });
  });
});

describe("compareFiles", () => {
  it("orders setup files first, then by round", () => {
    const names = ["review-2-a.md", "gate-1.md", "spec.md", "build-2.md", "intake.md", "build-1.md", "approve-2.md"];
    expect([...names].sort(compareFiles)).toEqual(["intake.md", "spec.md", "build-1.md", "gate-1.md", "build-2.md", "review-2-a.md", "approve-2.md"]);
  });
});
