# State contract

The files a factory writes, and their exact shape. This is the interface
between the factory (scripts + agents, installed by `factory-onboard`) and
anything that reads it, such as the dashboard in `ui/`.

Rules that hold for every file below:

- All JSON is UTF-8, written atomically (temp file + rename), so a reader never
  sees a half-written file. Readers should still tolerate a parse error by
  retrying on the next poll.
- Timestamps are ISO 8601 UTC with a `Z` suffix and second precision:
  `2026-11-27T14:32:05Z`.
- Unknown fields must be ignored by readers. Fields are only ever added within
  a `version`; a breaking change bumps `version`.
- `null` means "not known yet"; a missing optional field means the same.

## 1. Global registry: `~/.claude/factory/registry.json`

Written by `factory-onboard` (append or update by `path`). One entry per
installed factory.

```json
{
  "version": 1,
  "projects": [
    {
      "name": "my-app",
      "path": "/Users/me/dev/my-app",
      "backlog": "github",
      "merge": "pr",
      "repo": "me/my-app",
      "registered_at": "2026-11-27T14:32:05Z"
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Display name; defaults to the folder name. Unique in the registry. |
| `path` | string | Absolute path of the project's main checkout. The key. |
| `backlog` | `"local"` \| `"github"` | Where the queue lives. |
| `merge` | `"pr"` \| `"local"` | How jobs merge. |
| `repo` | string \| null | `owner/name` when the project has a GitHub remote. |
| `registered_at` | timestamp | First registration. |

Everything else about a project is read from `<path>/factory/config.json` and
`<path>/factory/jobs/`. A registry entry whose `path` no longer exists should
be shown as missing, not removed.

## 2. Project config: `<path>/factory/config.json`

Owned by the project (committed, protected from the factory's own branches).
The dashboard may read `name`, `backlog`, `merge`, `concurrency`,
`max_rounds`, `reviewers[].name` and `models.aliases`. Full schema:
[`templates/factory/config.json`](../templates/factory/config.json).

`models.efforts` (optional) is a flat object beside `models.agents`: agent
name → reasoning effort, one of `low`, `medium`, `high`, `xhigh`, `max`
(case-sensitive). Keys must be known agents: `intake`, `spec-writer`,
`builder`, `approver`, or a `reviewers[].name`. An agent with no entry runs at
its default effort. It is read from the live config on every spawn, so a
change applies to open jobs too. If the map is present but invalid (not an
object, an unknown agent, a value outside the list), `job next`, `feedback`,
`approve` and `merge` print `ERROR <message>` and change nothing.

```json
"models": {
  "aliases": {"...": "..."},
  "agents": {"builder": "opus"},
  "efforts": {"code-reviewer": "low", "builder": "high"}
}
```

## 3. Job folder: `<path>/factory/jobs/<job-id>/`

Gitignored, local to the machine running the factory. One folder per job.

### Job id

`gh-<issue-number>` (GitHub backlog) or `local-<backlog-file-stem>` (local
backlog), lower-case, `[a-z0-9-]`. If a folder with that id already exists, a
suffix `-2`, `-3`, … is added. Ids are stable for the job's life.

### `job.json`

Written **only** by `factory/bin/job`.

```json
{
  "version": 1,
  "id": "gh-42",
  "title": "Add dark mode toggle",
  "stage": "review",
  "waiting_on": null,
  "note": "gate PASS (round 2)",
  "issue": {
    "source": "github",
    "ref": "42",
    "url": "https://github.com/me/my-app/issues/42",
    "file": null,
    "author": "octocat"
  },
  "risk": "medium",
  "surfaces": ["ui"],
  "models": {
    "intake": "fable",
    "spec-writer": "opus",
    "builder": "opus",
    "approver": "opus"
  },
  "reviewers": [
    {"name": "code-reviewer", "model": "sonnet", "model_id": "claude-sonnet-5-5"},
    {"name": "ux-reviewer", "model": "sonnet", "model_id": "claude-sonnet-5-5"},
    {"name": "ui-reviewer", "model": "haiku", "model_id": "claude-haiku-5-5"}
  ],
  "efforts": {"builder": "high", "code-reviewer": "low"},
  "round": 2,
  "max_rounds": 4,
  "branch": "factory/gh-42",
  "worktree": "/Users/me/dev/my-app/factory/worktrees/gh-42",
  "base": "origin/main",
  "pr": {"number": 57, "url": "https://github.com/me/my-app/pull/57", "draft": true},
  "verdicts": {
    "intake": "ACCEPT",
    "gate": {"1": "FAIL", "2": "PASS"},
    "review": {"1": {}, "2": {"code-reviewer": "PASS", "ux-reviewer": "CHANGES"}},
    "approve": {},
    "merge_gate": {}
  },
  "issue_hash": "9f2c…",
  "cost": {
    "usd": 1.8342,
    "input_tokens": 120034,
    "output_tokens": 40211,
    "cache_write_tokens": 80000,
    "cache_read_tokens": 900000,
    "by_agent": {"intake": 0.0412, "spec-writer": 0.31, "builder": 1.2, "code-reviewer": 0.28},
    "transcripts": 6,
    "updated_at": "2026-11-27T15:01:44Z"
  },
  "created_at": "2026-11-27T14:32:05Z",
  "updated_at": "2026-11-27T15:01:44Z",
  "stage_entered_at": "2026-11-27T15:00:10Z",
  "history": [
    {"stage": "intake", "at": "2026-11-27T14:32:05Z", "round": 0, "note": "created"},
    {"stage": "spec", "at": "2026-11-27T14:33:40Z", "round": 0, "note": "ACCEPT risk=medium surfaces=ui"},
    {"stage": "build", "at": "2026-11-27T14:40:02Z", "round": 1, "note": ""},
    {"stage": "gate", "at": "2026-11-27T14:52:13Z", "round": 1, "note": ""},
    {"stage": "build", "at": "2026-11-27T14:53:30Z", "round": 2, "note": "gate FAIL"},
    {"stage": "gate", "at": "2026-11-27T14:59:58Z", "round": 2, "note": ""},
    {"stage": "review", "at": "2026-11-27T15:00:10Z", "round": 2, "note": "gate PASS"}
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Job id, equals the folder name. |
| `title` | string | Issue title. |
| `stage` | enum | See [stages](#stages). |
| `waiting_on` | `"author"` \| `"human"` \| null | Set in `needs-info` (author) and `needs-human` (human); null otherwise. |
| `note` | string | Last one-line status, human readable. |
| `issue.source` | `"github"` \| `"local"` | Backlog mode at job creation. |
| `issue.ref` | string | Issue number (github) or file stem (local). |
| `issue.url` | string \| null | Issue URL (github only). |
| `issue.file` | string \| null | Backlog file path relative to the project root (local only), e.g. `factory/backlog/dark-mode.md`. |
| `issue.author` | string \| null | Issue author login / front-matter `author`. |
| `risk` | `"low"` \| `"medium"` \| `"high"` \| null | Set by intake on ACCEPT. |
| `surfaces` | string[] | Subset of `config.surfaces` keys, set by intake. `[]` until then. |
| `models` | object | Alias per fixed role, copied from config at creation. |
| `reviewers` | object[] | Routed reviewers (`factory/bin/route`), set on ACCEPT; `[]` before. `model` is an alias, `model_id` the resolved id. |
| `efforts` | object (optional) | Agent → reasoning effort of that agent's most recent spawn (`low` … `max`), from `config.models.efforts` at spawn time. An agent with no key, or a job with no `efforts` field, was spawned at its default effort. Absent when no effort is in use; jobs created before this field existed lack it. |
| `round` | int | Build round. `0` before the first build, then 1, 2, … Increments every time the job re-enters `build`. |
| `max_rounds` | int | From config at creation. Exceeding it moves the job to `needs-human`. |
| `branch` | string \| null | `factory/<job-id>`, set on ACCEPT. |
| `worktree` | string \| null | Absolute path, set on ACCEPT; null again after the worktree is removed (merged / rejected). |
| `base` | string | Ref the branch is cut from and diffed against: `origin/<base_branch>` (pr) or `<base_branch>` (local). |
| `pr` | object \| null | `{number, url, draft}`; pr merge mode only, set after the first build round is pushed. |
| `verdicts.intake` | `"ACCEPT"` \| `"NEEDS-INFO"` \| `"REJECT"` \| null | Latest intake decision. |
| `verdicts.gate` | `{round: "PASS"\|"FAIL"}` | Gate result per round (keys are round numbers as strings). |
| `verdicts.review` | `{round: {reviewer: "PASS"\|"CHANGES"}}` | Per round, per reviewer; a reviewer missing from the inner object hasn't finished. |
| `verdicts.approve` | `{round: "APPROVE"\|"ESCALATE"}` | Approver decision per round. |
| `verdicts.merge_gate` | `{round: "PASS"\|"FAIL"}` | The gate re-run after syncing with the base before merging. |
| `issue_hash` | string \| null | sha256 of `issue.md` when intake last ran (or after the factory's own comment); a change while `needs-info` wakes the job. Internal. |
| `cost` | object \| null | API-equivalent spend of this job's subagents, see [cost](#cost). |
| `created_at`, `updated_at` | timestamp | |
| `stage_entered_at` | timestamp | When the current `stage` was entered (time-in-stage = now − this). |
| `history` | object[] | Every stage entry in order: `{stage, at, round, note}`. Per-stage durations are the gaps between consecutive entries. The first entry is always `intake`. |

### SPAWN line

`job next` (and `feedback`, `approve`) tells the orchestrator which agents to
start with one line:

```
<id> <stage> SPAWN <agent>:<model>[:<effort>] [<agent>:<model>[:<effort>] ...] out=<file>[,<file>...]
```

The third field is present only for an agent with an entry in
`config.models.efforts`, e.g. `gh-42 review SPAWN code-reviewer:sonnet:low
ui-reviewer:haiku out=review-2-code-reviewer.md,review-2-ui-reviewer.md`. The
orchestrator passes it as the Agent tool's `effort`; with two fields it passes
no effort. `job.json` `efforts` is saved before the line is printed.

### Stages

| Stage | Meaning | Who acts next |
|---|---|---|
| `intake` | Intake agent deciding (or about to). | factory |
| `needs-info` | Intake asked the author a question; waiting for a reply. | author |
| `spec` | Spec writer writing `spec.md`. | factory |
| `build` | Builder working on round `round`. | factory |
| `gate` | `checks.sh` + protected-path check running for round `round`. | factory |
| `review` | Routed reviewers running in parallel for round `round`. | factory |
| `approve` | Approver deciding for round `round`. | factory |
| `merging` | Syncing with base, gating again, merging. | factory |
| `needs-human` | Escalated, out of rounds, or a merge problem. See `note`. | human |
| `merged` | Done: merged. Terminal. | — |
| `rejected` | Done: rejected by intake or by a human. Terminal. | — |

Legal moves (the `TRANSITIONS` table in `factory/bin/job`; anything else is
refused):

```
intake      → spec | needs-info | rejected
needs-info  → intake | rejected
spec        → build | rejected
build       → gate | needs-human | rejected
gate        → review | build | needs-human | rejected
review      → approve | build | needs-human | rejected
approve     → merging | build | needs-human | rejected
merging     → merged | build | needs-human | rejected
needs-human → build | merging | merged | rejected
merged      → (none)
rejected    → (none)
```

Suggested dashboard columns: **Queue** (`intake`, `needs-info`),
**Building** (`spec`, `build`, `gate`), **Review** (`review`, `approve`,
`merging`), **Needs you** (`needs-human`, plus `needs-info` if you also want
author waits there), **Done** (`merged`, `rejected`).

### Cost

`factory/bin/job` sums every subagent transcript under
`~/.claude/projects/<project-slug>/**/subagents/*.jsonl` whose first prompt
contains `Factory job: <absolute job folder>`, pricing each assistant message
by its model with `config.prices_usd_per_mtok`. `by_agent` keys are agent
names taken from the prompt's `Agent: <name>` line. It is refreshed on every
`job next` and `job cost`. It's the API-equivalent cost, not a bill, and it
depends on an undocumented transcript format: show it, but treat `null` or a
stale `updated_at` as normal.

### Files in a job folder

Every agent-written file and every script-written `.md` opens with
`## Summary` followed by 3–5 `- ` bullets. A dashboard can show that block as
the card for the stage and link to the rest. Verdict lines are plain
`Key: VALUE` lines right after the summary (under `## Verdict`), parsed by
`factory/bin/job`.

| File | Written by | When | Verdict lines |
|---|---|---|---|
| `job.json` | `job` | always | — |
| `issue.md` | `backlog` (via `job`) | at creation; refreshed while `needs-info` | — (quoted issue data, no Summary) |
| `intake.md` | intake agent | `intake` | `Decision: ACCEPT\|NEEDS-INFO\|REJECT`, `Risk: low\|medium\|high`, `Surfaces: ui, security` (or `none`) |
| `intake-<k>.md` | `job` | an earlier intake run, archived when the author replied (k = 1, 2, …) | as above |
| `spec.md` | spec-writer | `spec` | — |
| `build-<round>.md` | builder | `build` | — |
| `gate-<round>.md` | `gate` | `gate` | `Result: PASS\|FAIL` |
| `gate-<round>.log` | `gate` | `gate` | full `checks.sh` output (plain text) |
| `review-<round>-<reviewer>.md` | each routed reviewer | `review` | `Verdict: PASS\|CHANGES` |
| `feedback-<k>.md` | `job feedback` (human words) or `job` (merge conflict) | any time; consumed by the next build round | — |
| `approve-<round>.md` | approver | `approve` | `Decision: APPROVE\|ESCALATE` |
| `merge-gate-<round>.md` / `.log` | `gate` | `merging` | `Result: PASS\|FAIL` |
| `merge.md` | `job merge` | `merging` → `merged` or failure | — |
| `reject.md` | `job reject` | human rejection | — |
| `.lock` | `job` | transient lock file; ignore | — |

`<round>` is the job's `round` at the time; `<reviewer>` is the reviewer's
`name` from config (e.g. `review-2-code-reviewer.md`). `feedback-<k>.md` is
numbered independently of rounds; the builder reads every feedback file newer
than its previous build file.

## 4. Backlog file (local mode): `<path>/factory/backlog/<stem>.md`

```markdown
---
title: Add dark mode toggle
status: ready
author: lp
---
Free text describing the request.

## Factory log
<!-- appended by the factory: intake decisions, questions, rejections -->
```

`status` is the trust boundary: only `ready` files are picked up. The factory
sets `status: rejected` on rejection and `status: done` on merge; it never
edits the text above `## Factory log` otherwise. The author answers a
NEEDS-INFO question by editing the file (anywhere); any change to it wakes
the job.
