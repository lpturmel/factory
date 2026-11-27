import { describe, expect, it } from "bun:test";
import type { ApiFactory, JobJson } from "../src/shared/contract.ts";
import {
  DAY, MIN, attentionFile, attentionItems, attentionKind, gateFailStreak, phaseOf, reviewMatrix, runState, throughput7d,
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
