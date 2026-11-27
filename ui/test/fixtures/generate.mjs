// Writes a demo factory home to ui/.demo/ (or the folder given as argv[2]):
// registry.json plus project folders whose factory/jobs/*/ follow docs/state-contract.md.
// Timestamps are relative to now, so the demo always looks live.
//
//   node test/fixtures/generate.mjs [outDir]

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(here, "..", "..", ".demo"));
const NOW = Date.now();
const M = 60_000;
const iso = (t) => new Date(Math.round(t / 1000) * 1000).toISOString().replace(/\.000Z$/, "Z");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const md = (summary, verdicts = {}, body = "") =>
  `## Summary\n${summary.map((s) => `- ${s}`).join("\n")}\n` +
  (Object.keys(verdicts).length ? `\n## Verdict\n${Object.entries(verdicts).map(([k, v]) => `${k}: ${v}`).join("\n")}\n` : "") +
  (body ? `\n## Detail\n${body}\n` : "\n## Detail\nThe rest of the agent's file: reasoning, the diff hunks it refers to, and anything it wants the next agent to know.\n");

const R = (name, model) => ({ name, model, model_id: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5", opus: "claude-opus-5-5" }[model] });

/**
 * steps: [stage, round, minutes, note] in order; the last step is the current stage
 * (its minutes = time in stage so far). Times run backwards from now.
 */
function job(project, spec) {
  const total = spec.steps.reduce((s, x) => s + x[2], 0) + (spec.idle ?? 0);
  let t = NOW - total * M;
  const history = spec.steps.map(([stage, round, mins, note]) => { const e = { stage, at: iso(t), round, note: note ?? "" }; t += mins * M; return e; });
  const last = history[history.length - 1];
  const updated = spec.updatedAgo != null ? NOW - spec.updatedAgo * M : NOW - (spec.idle ?? 0) * M - Math.min(spec.steps.at(-1)[2], 2) * M;
  const j = {
    version: 1,
    id: spec.id,
    title: spec.title,
    stage: last.stage,
    waiting_on: last.stage === "needs-info" ? "author" : last.stage === "needs-human" ? "human" : null,
    note: spec.note ?? last.note,
    issue: project.backlog === "github"
      ? { source: "github", ref: spec.id.replace(/^gh-/, ""), url: `https://github.com/${project.repo}/issues/${spec.id.replace(/^gh-/, "")}`, file: null, author: "octocat" }
      : { source: "local", ref: spec.id.replace(/^local-/, ""), url: null, file: `factory/backlog/${spec.id.replace(/^local-/, "")}.md`, author: "dev" },
    risk: spec.risk ?? null,
    surfaces: spec.surfaces ?? [],
    models: { intake: "fable", "spec-writer": "opus", builder: "opus", approver: "opus" },
    reviewers: spec.reviewers ?? [],
    round: spec.round ?? 0,
    max_rounds: spec.max ?? 3,
    branch: spec.risk ? `factory/${spec.id}` : null,
    worktree: null,
    base: project.merge === "pr" ? "origin/main" : "main",
    pr: spec.pr ? { number: spec.pr, url: `https://github.com/${project.repo}/pull/${spec.pr}`, draft: last.stage !== "needs-human" } : null,
    verdicts: { intake: spec.risk ? "ACCEPT" : last.stage === "needs-info" ? "NEEDS-INFO" : last.stage === "rejected" ? "REJECT" : null, gate: {}, review: {}, approve: {}, merge_gate: {}, ...spec.verdicts },
    issue_hash: null,
    cost: spec.cost == null ? null : { usd: spec.cost, by_agent: spec.byAgent ?? { builder: +(spec.cost * 0.6).toFixed(4), "spec-writer": +(spec.cost * 0.15).toFixed(4), intake: +(spec.cost * 0.05).toFixed(4), "code-reviewer": +(spec.cost * 0.2).toFixed(4) }, updated_at: iso(updated) },
    created_at: history[0].at,
    updated_at: iso(updated),
    stage_entered_at: last.at,
    history,
  };
  const dir = join(project.abs, "factory", "jobs", spec.id);
  write(join(dir, "job.json"), JSON.stringify(j, null, 2) + "\n");
  write(join(dir, "issue.md"), `> ${spec.title}\n\n(quoted issue text)\n`);
  for (const [name, f] of Object.entries(spec.files ?? {})) write(join(dir, name), typeof f === "string" ? f : md(f[0], f[1] ?? {}, f[2] ?? ""));
}

function project(name, opts) {
  const abs = join(out, "projects", name);
  const p = { name, path: `projects/${name}`, abs, backlog: opts.backlog, merge: opts.merge, repo: opts.repo ?? null };
  write(join(abs, "factory", "config.json"), JSON.stringify({
    version: 1, name, backlog: opts.backlog, merge: opts.merge, concurrency: opts.concurrency ?? 3, max_rounds: 3,
    reviewers: (opts.reviewers ?? ["code-reviewer"]).map((n) => ({ name: n })),
  }, null, 2) + "\n");
  if (opts.run) write(join(abs, "factory", "run.json"), JSON.stringify({ pid: 4242, started_at: iso(NOW - 5 * 60 * M), heartbeat_at: iso(NOW - 4000), stopped_at: null, concurrency: opts.concurrency ?? 3 }, null, 2) + "\n");
  return p;
}

// ---------- tidepool (game, local backlog) ----------
const tide = project("tidepool", { backlog: "local", merge: "local", concurrency: 3, run: true, reviewers: ["code-reviewer", "ux-reviewer", "ui-reviewer", "gameplay-reviewer"] });
const gameRevs = [R("code-reviewer", "sonnet"), R("ux-reviewer", "sonnet"), R("ui-reviewer", "haiku"), R("gameplay-reviewer", "sonnet")];

job(tide, {
  id: "local-dash-cooldown", title: "Dash ability cooldown feels sluggish", risk: "medium", surfaces: ["gameplay", "ui"], reviewers: gameRevs, round: 3, max: 3, cost: 18.62,
  byAgent: { builder: 11.91, "gameplay-reviewer": 1.9, "spec-writer": 1.48, "code-reviewer": 1.4, "ux-reviewer": 1.1, intake: 0.62, "ui-reviewer": 0.21 },
  note: "max_rounds (3) reached",
  steps: [["intake", 0, 3, "created"], ["spec", 0, 14, "ACCEPT risk=medium surfaces=gameplay,ui"], ["build", 1, 38], ["gate", 1, 4], ["review", 1, 19, "gate PASS"],
    ["build", 2, 31, "review CHANGES"], ["gate", 2, 3], ["build", 3, 26, "gate FAIL"], ["gate", 3, 4], ["review", 3, 18, "gate PASS"], ["needs-human", 3, 47, "max_rounds (3) reached"]],
  verdicts: { gate: { 1: "PASS", 2: "FAIL", 3: "PASS" }, review: { 1: { "code-reviewer": "PASS", "ux-reviewer": "PASS", "ui-reviewer": "PASS", "gameplay-reviewer": "CHANGES" }, 2: {}, 3: { "code-reviewer": "PASS", "ux-reviewer": "PASS", "ui-reviewer": "PASS", "gameplay-reviewer": "CHANGES" } } },
  files: {
    "intake.md": [["Accepted; rescoped from \"dash feels bad\" to the cooldown value and its HUD indicator.", "Risk medium: changes player movement timings used by every level.", "Surfaces: gameplay, ui (cooldown ring on HUD).", "Out of scope: dash distance and i-frames."], { Decision: "ACCEPT", Risk: "medium", Surfaces: "gameplay, ui" }],
    "spec.md": [["Cooldown 0.6 s → 0.35 s, exposed as DASH_COOLDOWN in player/tuning.ron.", "HUD ring fills over the cooldown; hidden when ready.", "Acceptance: dash-chain playtest passes on levels 1-1 to 4-3."]],
    "build-1.md": [["Tuning value moved to player/tuning.ron; Dash system reads it.", "HUD ring added in ui/hud/dash_ring.rs.", "3 new tests; playtest script updated."]],
    "gate-1.md": [["checks.sh passed: fmt, clippy, 214 tests, wasm build."], { Result: "PASS" }],
    "gate-1.log": "▸ cargo fmt --check ... ok\n▸ cargo clippy -D warnings ... ok\n▸ cargo test --workspace\n    test result: ok. 214 passed\n✓ gate PASS\n",
    "review-1-code-reviewer.md": [["Diff matches the spec; tests cover the new tuning path."], { Verdict: "PASS" }],
    "review-1-ux-reviewer.md": [["Ring is readable at a glance; no flow changes."], { Verdict: "PASS" }],
    "review-1-ui-reviewer.md": [["Ring uses the HUD palette and spacing."], { Verdict: "PASS" }],
    "review-1-gameplay-reviewer.md": [["At 0.35 s the player can chain dash → wall-jump → dash and skip the 4-2 gap puzzle.", "Suggests gating the second dash on ground contact, not only the timer."], { Verdict: "CHANGES" }],
    "build-2.md": [["Second dash now needs ground or wall contact since the last dash.", "Added test dash_requires_contact_after_chain.", "Also edited the level 4-2 collision mask (not asked for)."]],
    "gate-2.md": [["tests/levels.rs::level_4_2_collision_unchanged failed.", "Log sent to the builder; no reviewers spawned."], { Result: "FAIL" }],
    "gate-2.log": "$ factory/checks.sh   (main checkout copy, branch factory/local-dash-cooldown @ 9c41e2a)\n▸ cargo fmt --check ............................ ok   0.8s\n▸ cargo clippy -D warnings ..................... ok  41.2s\n▸ cargo test --workspace\n    running 216 tests\n    test player::dash::cooldown_resets_on_respawn ... ok\n    test player::dash::dash_requires_contact_after_chain ... ok\n    test levels::level_4_2_collision_unchanged ... FAILED\n\n    ---- levels::level_4_2_collision_unchanged stdout ----\n    assertion failed: mask_hash(&level) == GOLDEN_4_2\n      left: 0x9f13c0aa  right: 0x51d2e804\n    test result: FAILED. 215 passed; 1 failed\n✕ gate FAIL (exit 101) after 2m 51s\n",
    "build-3.md": [["Reverted the collision mask change.", "Kept 0.35 s per spec; wall contact no longer resets the dash.", "Spec and reviewer disagree: conflict noted for the approver."]],
    "gate-3.md": [["checks.sh passed: fmt, clippy, 217 tests."], { Result: "PASS" }],
    "review-3-code-reviewer.md": [["Revert is clean; new rule is tested."], { Verdict: "PASS" }],
    "review-3-ux-reviewer.md": [["No UX regressions."], { Verdict: "PASS" }],
    "review-3-ui-reviewer.md": [["No visual changes since round 1."], { Verdict: "PASS" }],
    "review-3-gameplay-reviewer.md": [["Keep 0.35 s and lose the 3-1 wall-dash route, or go to 0.45 s and keep the wall reset?", "Removing the wall reset makes the 3-1 wall-dash route impossible.", "This is a design call: speed vs. the 4-2 puzzle vs. the 3-1 route."], { Verdict: "CHANGES" }],
  },
});

job(tide, {
  id: "local-save-migration", title: "Save slots survive game updates", risk: "high", surfaces: [], reviewers: [R("code-reviewer", "sonnet")], round: 3, max: 4, cost: 11.05,
  steps: [["intake", 0, 2], ["spec", 0, 12], ["build", 1, 70], ["gate", 1, 30], ["build", 2, 60, "gate FAIL"], ["gate", 2, 30], ["build", 3, 55, "gate FAIL"], ["gate", 3, 1]],
  verdicts: { gate: { 1: "FAIL", 2: "FAIL" } }, updatedAgo: 1,
  files: {
    "intake.md": [["Accepted as written.", "Risk high: player save data."], { Decision: "ACCEPT", Risk: "high", Surfaces: "none" }],
    "spec.md": [["Versioned save format with a v3 → v4 migration.", "Round-trip test over every shipped save fixture."]],
    "gate-1.md": [["tests/save_migration.rs::v3_to_v4 timed out after 300 s."], { Result: "FAIL" }],
    "gate-2.md": [["tests/save_migration.rs::v3_to_v4 times out every round.", "Builder got the log."], { Result: "FAIL" }],
    "gate-2.log": "▸ cargo test --workspace\n    test save_migration::v3_to_v4 has been running for over 60 seconds\n    test save_migration::v3_to_v4 ... FAILED (timeout 300s)\n✕ gate FAIL (exit 101)\n",
  },
});

job(tide, {
  id: "local-pause-menu", title: "Pause menu with resume, settings and quit", risk: "medium", surfaces: ["ui", "gameplay"], reviewers: gameRevs, round: 1, max: 3, cost: 6.48,
  steps: [["intake", 0, 3], ["spec", 0, 11], ["build", 1, 80], ["gate", 1, 4], ["review", 1, 11, "gate PASS"]], updatedAgo: 0.3,
  verdicts: { gate: { 1: "PASS" }, review: { 1: { "code-reviewer": "PASS", "ui-reviewer": "PASS" } } },
  files: { "intake.md": [["Accepted.", "Surfaces: ui, gameplay."], { Decision: "ACCEPT" }], "spec.md": [["Esc / Start opens the menu; time scale 0 while open."]], "build-1.md": [["Menu scene and input routing added."]], "gate-1.md": [["checks.sh passed."], { Result: "PASS" }], "review-1-code-reviewer.md": [["Looks good."], { Verdict: "PASS" }], "review-1-ui-reviewer.md": [["Matches the HUD style."], { Verdict: "PASS" }] },
});

job(tide, {
  id: "local-coyote-time", title: "Coyote time for ledge jumps", risk: "low", surfaces: ["gameplay"], reviewers: [R("code-reviewer", "haiku"), R("gameplay-reviewer", "sonnet")], round: 0, cost: 0.88,
  steps: [["intake", 0, 3], ["spec", 0, 4]], updatedAgo: 0.5,
  files: { "intake.md": [["Accepted: 100 ms coyote window."], { Decision: "ACCEPT", Risk: "low", Surfaces: "gameplay" }] },
});

job(tide, {
  id: "local-enemy-spawns", title: "Better enemy spawns", round: 0, cost: 0.19,
  steps: [["intake", 0, 20], ["needs-info", 0, 29 * 60]],
  files: { "intake.md": [["Which levels, and is \"better\" fewer spawns, smarter placement, or more variety?", "Too vague to spec; asked the author."], { Decision: "NEEDS-INFO" }] },
});

job(tide, { id: "local-screen-shake", title: "Screen shake on heavy landing", risk: "low", surfaces: ["gameplay"], reviewers: [R("code-reviewer", "haiku"), R("gameplay-reviewer", "sonnet")], round: 2, cost: 4.4,
  steps: [["intake", 0, 3], ["spec", 0, 10], ["build", 1, 60], ["gate", 1, 4], ["review", 1, 20], ["build", 2, 40], ["gate", 2, 4], ["review", 2, 15], ["approve", 2, 5], ["merging", 2, 6], ["merged", 2, 22 * 60]],
  verdicts: { gate: { 1: "PASS", 2: "PASS" }, review: { 1: { "code-reviewer": "PASS", "gameplay-reviewer": "CHANGES" }, 2: { "code-reviewer": "PASS", "gameplay-reviewer": "PASS" } }, approve: { 2: "APPROVE" }, merge_gate: { 2: "PASS" } } });
job(tide, { id: "local-rumble", title: "Controller rumble support", risk: "medium", surfaces: ["gameplay"], reviewers: [R("code-reviewer", "sonnet"), R("gameplay-reviewer", "sonnet")], round: 1, cost: 5.15,
  steps: [["intake", 0, 3], ["spec", 0, 12], ["build", 1, 90], ["gate", 1, 5], ["review", 1, 20], ["approve", 1, 4], ["merging", 1, 6], ["merged", 1, 40 * 60]],
  verdicts: { gate: { 1: "PASS" }, review: { 1: { "code-reviewer": "PASS", "gameplay-reviewer": "PASS" } }, approve: { 1: "APPROVE" }, merge_gate: { 1: "PASS" } } });

// ---------- ledgerline (web, GitHub) ----------
const ledger = project("ledgerline", { backlog: "github", merge: "pr", repo: "acme/ledgerline", concurrency: 4, run: true, reviewers: ["code-reviewer", "ux-reviewer", "ui-reviewer", "security-reviewer"] });

job(ledger, {
  id: "gh-142", title: "Archive closed invoices older than 7 years", risk: "high", surfaces: ["security"], reviewers: [R("code-reviewer", "sonnet"), R("security-reviewer", "opus")], round: 2, max: 3, cost: 9.84, pr: 388,
  note: "approver ESCALATE (round 2)",
  steps: [["intake", 0, 3], ["spec", 0, 15], ["build", 1, 70], ["gate", 1, 6], ["review", 1, 25], ["build", 2, 50, "review CHANGES"], ["gate", 2, 6], ["review", 2, 22], ["approve", 2, 8], ["needs-human", 2, 200, "approver ESCALATE"]],
  verdicts: { gate: { 1: "PASS", 2: "PASS" }, review: { 1: { "code-reviewer": "PASS", "security-reviewer": "CHANGES" }, 2: { "code-reviewer": "PASS", "security-reviewer": "PASS" } }, approve: { 2: "ESCALATE" } },
  files: {
    "intake.md": [["Accepted.", "Risk high: deletes data."], { Decision: "ACCEPT", Risk: "high", Surfaces: "security" }],
    "approve-2.md": [["Migration drops invoices.legacy_ref. Nothing in this repo reads it, but a nightly export in another repo might.", "Drop it, or keep it nullable?"], { Decision: "ESCALATE" }],
  },
});
job(ledger, {
  id: "gh-149", title: "Fix rounding in multi-currency totals", risk: "low", surfaces: [], reviewers: [R("code-reviewer", "haiku")], round: 3, max: 3, cost: 3.37, pr: 389,
  steps: [["intake", 0, 2], ["spec", 0, 9], ["build", 1, 24], ["gate", 1, 6], ["build", 2, 41, "gate FAIL"], ["gate", 2, 7], ["build", 3, 3, "gate FAIL"]],
  verdicts: { gate: { 1: "FAIL", 2: "FAIL" } }, updatedAgo: 0.2,
  files: {
    "intake.md": [["Accepted as written.", "Risk low: pure function in money/convert.ts."], { Decision: "ACCEPT", Risk: "low", Surfaces: "none" }],
    "spec.md": [["Round half-even at the final sum, not per line.", "Property test over 3 currencies."]],
    "build-1.md": [["Switched to bigint minor units.", "Added fast-check property test."]],
    "gate-1.md": [["typecheck: 4 errors in reports/summary.ts (number vs bigint)."], { Result: "FAIL" }],
    "gate-1.log": "▸ pnpm lint ... ok\n▸ pnpm typecheck\nsrc/reports/summary.ts:48:11 - error TS2322: Type 'bigint' is not assignable to type 'number'.\nsrc/reports/summary.ts:52:20 - error TS2365: Operator '+' cannot be applied to types 'number' and 'bigint'.\n✕ gate FAIL (exit 2)\n",
    "build-2.md": [["Updated reports/summary.ts to bigint.", "Property test now seeds 1000 runs."]],
    "gate-2.md": [["Property test failed: JPY (0 decimals) rounds 0.5 up.", "Builder got the log; no reviewers spawned."], { Result: "FAIL" }],
    "gate-2.log": "▸ pnpm lint ... ok\n▸ pnpm typecheck ... ok\n▸ pnpm test\n  FAIL  src/money/convert.property.test.ts\n    ✕ sum rounds half-even for any currency (seed 1932847, 1000 runs)\n      Counterexample: [{ currency: \"JPY\", lines: [0.5, 0.5, 0.5] }]\n      Expected: 2   Received: 1\n✕ gate FAIL (exit 1) after 6m 40s\n",
  },
});
job(ledger, { id: "gh-151", title: "Show VAT breakdown on invoice PDF", risk: "medium", surfaces: ["ui"], reviewers: [R("code-reviewer", "sonnet"), R("ux-reviewer", "sonnet"), R("ui-reviewer", "haiku")], round: 2, cost: 4.12, pr: 391,
  steps: [["intake", 0, 3], ["spec", 0, 12], ["build", 1, 60], ["gate", 1, 5], ["review", 1, 30], ["build", 2, 40, "review CHANGES"], ["gate", 2, 5], ["review", 2, 6, "gate PASS"]], updatedAgo: 0.4,
  verdicts: { gate: { 1: "PASS", 2: "PASS" }, review: { 1: { "code-reviewer": "PASS", "ux-reviewer": "CHANGES", "ui-reviewer": "PASS" }, 2: { "ux-reviewer": "PASS" } } } });
job(ledger, { id: "gh-153", title: "Rate-limit password reset endpoint", risk: "medium", surfaces: ["security"], reviewers: [R("code-reviewer", "sonnet"), R("security-reviewer", "opus")], round: 1, cost: 1.96,
  steps: [["intake", 0, 3], ["spec", 0, 45], ["build", 1, 22]], updatedAgo: 0.6 });
job(ledger, { id: "gh-155", title: "Add CSV import for bank statements", round: 0, cost: 0.21, steps: [["intake", 0, 2]], updatedAgo: 0.5 });
job(ledger, { id: "gh-140", title: "Paginate customer list API", risk: "low", reviewers: [R("code-reviewer", "haiku")], round: 1, cost: 1.42, pr: 384,
  steps: [["intake", 0, 2], ["spec", 0, 8], ["build", 1, 30], ["gate", 1, 5], ["review", 1, 10], ["approve", 1, 4], ["merging", 1, 5], ["merged", 1, 20 * 60]],
  verdicts: { gate: { 1: "PASS" }, review: { 1: { "code-reviewer": "PASS" } }, approve: { 1: "APPROVE" }, merge_gate: { 1: "PASS" } } });
job(ledger, { id: "gh-136", title: "Rewrite billing engine in Rust", round: 0, cost: 0.34, steps: [["intake", 0, 5], ["rejected", 0, 3 * 24 * 60]],
  files: { "intake.md": [["Too large for one PR; asked for a split into tracked issues."], { Decision: "REJECT" }] } });

// ---------- infra-scripts (stopped) ----------
const infra = project("infra-scripts", { backlog: "github", merge: "pr", repo: "acme/infra-scripts" });
job(infra, { id: "gh-61", title: "Rotate staging DB credentials monthly", round: 0, cost: 0.24, steps: [["intake", 0, 60], ["needs-info", 0, 3 * 24 * 60 + 180]],
  files: { "intake.md": [["Which secret store holds the staging credentials today?"], { Decision: "NEEDS-INFO" }] } });
job(infra, { id: "gh-64", title: "Terraform fmt check in CI", risk: "low", reviewers: [R("code-reviewer", "haiku")], round: 1, cost: 0.92, steps: [["intake", 0, 3], ["spec", 0, 10], ["build", 1, 30]], idle: 3 * 24 * 60 + 120 });

// ---------- factory (idle) ----------
const fac = project("factory", { backlog: "local", merge: "local" });
job(fac, { id: "local-dashboard-docs", title: "Document the dashboard reader", risk: "low", reviewers: [R("code-reviewer", "haiku")], round: 1, cost: 1.9,
  steps: [["intake", 0, 2], ["spec", 0, 6], ["build", 1, 20], ["gate", 1, 3], ["review", 1, 5], ["approve", 1, 3], ["merging", 1, 2], ["merged", 1, 125]],
  verdicts: { gate: { 1: "PASS" }, review: { 1: { "code-reviewer": "PASS" } }, approve: { 1: "APPROVE" }, merge_gate: { 1: "PASS" } } });

// ---------- registry ----------
const projects = [tide, ledger, infra, fac].map((p) => ({ name: p.name, path: p.path, backlog: p.backlog, merge: p.merge, repo: p.repo, registered_at: iso(NOW - 30 * 24 * 60 * M) }));
projects.push({ name: "docs-site", path: "projects/docs-site", backlog: "github", merge: "pr", repo: "acme/docs-site", registered_at: iso(NOW - 40 * 24 * 60 * M) });
write(join(out, "registry.json"), JSON.stringify({ version: 1, projects }, null, 2) + "\n");
console.log(`demo factory home written to ${out}`);
