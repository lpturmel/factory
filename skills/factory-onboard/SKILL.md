---
name: factory-onboard
description: Install a software factory into the current project (new or existing) — a fixed pipeline that turns a backlog into merged code with intake, spec, build, gate, review and approval. Interviews you about backlog, merge mode, reviewers, concurrency and check commands, then stamps out the skill, agents, scripts and config and registers the project for the factory dashboard. Use when asked to "set up a factory", "onboard this repo to the factory", or "/factory-onboard".
argument-hint: "[project path, default: current directory]"
---

# Onboard a project to the software factory

You install a factory into a project by interviewing the user, writing an
answers file, and running `install.py` from this skill's folder. Don't
hand-copy templates: the installer does the stamping, so installs are
identical. The design is in the factory repo's `docs/reference-design.md`
and the file formats in `docs/state-contract.md`.

**Paths.** This skill's base directory is shown when it loads. The installer
is `<base>/install.py`; it finds the templates at `<base>/../../templates`
by resolving symlinks, so the skill must be installed as a symlink into the
factory repo (README). If `<base>/../../templates/factory/bin/job` doesn't
exist, ask the user where the factory repo is and pass `--templates`.

The project is `$ARGUMENTS` if given, else the current directory.

## 1. Inspect (read-only, no questions yet)

Run these and keep the results; each answer below gets a suggested default
from them.

- Git: `git -C <project> rev-parse --show-toplevel`, current branch, and
  `git remote get-url origin`. A `github.com` remote plus a working
  `gh auth status` means GitHub is available; `gh repo view --json nameWithOwner`
  gives `owner/name`. Base branch: `git symbolic-ref --short refs/remotes/origin/HEAD`
  (strip `origin/`), else the current branch, else `main`.
- Already installed? If `factory/config.json` exists, read it, tell the user,
  and ask whether to **update** (re-run with `--force`, which overwrites the
  factory's own files and keeps `factory/jobs/` and the backlog) or stop.
- Project kind, from manifests and dependencies:
  - **web app**: `package.json` with react / vue / svelte / next / nuxt /
    angular / solid / astro, or templates and CSS in a Python/Ruby web app.
  - **game**: Godot (`project.godot`), Unity (`ProjectSettings/`), Unreal
    (`*.uproject`), Bevy, pygame, Phaser, LÖVE, raylib, or a `game` in the
    name and a render loop.
  - **CLI / library / service**: anything else.
  - Security-sensitive signs: auth, payments, crypto, user data, public API.
- Check commands, in this order of preference:
  - `package.json` scripts named `lint`, `typecheck`/`type-check`/`tsc`,
    `test`, `build` → `npm run <name>` (use `pnpm`/`yarn`/`bun` if its
    lockfile is present). Add `CI=1` where a test runner watches by default.
  - `Makefile` targets `lint`, `test`, `check`, `build`.
  - Rust: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`.
  - Python: `ruff check .`, `mypy .` (if configured), `pytest -q`.
  - Go: `go vet ./...`, `go test ./...`.
  - CI config (`.github/workflows/*.yml`) is the best hint of what the team
    already treats as "passing".
  Only propose commands that exist; never invent a test command.

## 2. Interview

Use AskUserQuestion. Put the suggested default first, labeled
"(Recommended)", and say in the description why you suggest it. Every
question gets "Other" automatically for free text.

**Call 1** (four questions):

1. *Backlog* — "Where should the factory's backlog live?"
   - `GitHub issues labeled factory` — recommended when GitHub is available.
     Only people with triage/write access can label, so the label is the
     trust boundary.
   - `Local files in factory/backlog/` — recommended without GitHub. A file
     runs when its front matter says `status: ready`.
2. *Merge mode* — "How should approved jobs merge?"
   - `Pull request (gh pr merge)` — recommended with a GitHub remote; branch
     protection and required checks apply.
   - `Local integration` — the job's worktree merges the base branch, gates
     again, then fast-forwards the base branch. Never merges in your checkout.
     Recommended without a GitHub remote.
3. *Concurrency* — "How many jobs may run at once?" `3 (Recommended)`, `1`,
   `2`, `5`. (Claude Code allows about 20 concurrent subagents per session;
   3 jobs × 4 reviewers fits.)
4. *Max rounds* — "How many build rounds before a human is asked?"
   `4 (Recommended)`, `2`, `3`, `6`.

**Call 2: reviewers** — one multiSelect question: "Which reviewers should
the factory run?" Offer up to four from this list, pre-chosen for the project
kind, each label the reviewer's name and the description its `when` and
model. `code-reviewer` is always first and recommended.

| name | purpose | model | when | suggest for |
|---|---|---|---|---|
| `code-reviewer` | Correctness, scope and test integrity of the diff. | `{"low":"haiku","medium":"sonnet","high":"sonnet"}` | `always` | every project |
| `ui-reviewer` | Visual fit with the existing design. | `haiku` | `ui` | web/desktop/mobile apps, games with menus |
| `ux-reviewer` | Usability of flows, states, copy and accessibility. | `sonnet` | `ui` | web/desktop/mobile apps |
| `security-reviewer` | Vulnerabilities, unsafe input, secrets, permissions. | `opus` | `security` | anything with auth, user data, network or payments; offer it to everyone |
| `gameplay-reviewer` | Game feel, rules, balance and player-facing behavior. | `sonnet` | `gameplay` | games |
| `api-reviewer` | Public API and compatibility of interfaces. | `sonnet` | `api` | libraries, services |
| `perf-reviewer` | Hot paths, allocations, queries, frame budget. | `sonnet` | `high` | games, data-heavy services |

If the user picks "Other", ask for each custom reviewer's **name**
(kebab-case, ending in `-reviewer`), **purpose** (one sentence), **model**
(`haiku`, `sonnet`, `opus`, or haiku→sonnet by risk) and **when** (`always`,
a risk level `low`/`medium`/`high` meaning that risk or higher, or a surface
name). Then, in one more call, confirm the model and `when` for the chosen
reviewers if the user may want to change them (skip when they took the
defaults).

Surfaces are every non-risk `when` among the chosen reviewers, plus `ui` and
`security` if any reviewer uses them. Write one sentence per surface that
tells intake when a change touches it (e.g. `gameplay`: "Changes rules,
controls, physics, balance, AI or anything the player feels.").

Each reviewer also needs a `focus`: 3–6 bullet lines for its agent file,
specific to this project. Draft them from the purpose and what you saw in the
repo. The `code-reviewer` focus must include: "Fail any test that was
weakened, skipped, deleted or special-cased to pass", and "Fail changes
outside the spec's scope".

**Call 3: checks** — "factory/checks.sh will run these commands, in order;
any failure fails the gate:" with options `Use these (Recommended)` (list the
detected commands in the description), `Edit the list` (then ask for the
list as free text), and `None for now` (the gate then only checks commits and
protected paths; warn that reviewers are then the only judge).

**Call 4: finishing touches** (two questions):

1. "Pre-approve what the factory's background agents need?" — `Yes
   (Recommended)`: background subagents can't answer permission prompts, so
   anything not pre-approved is silently denied and the job stalls. Adds to
   `.claude/settings.json`: allow `Bash(factory/bin/job:*)`,
   `Bash(factory/bin/backlog list)`, `Bash(git -C:*)`, `Bash(chmod +x:*)`,
   `Read`, `Glob`, `Grep`, `Edit`, `Write`. It denies nothing, so you can
   still push from Claude; `git push` isn't pre-approved, and the agents are
   told never to push (`factory/bin/job` does). On update it removes the
   `git push` deny rules older installs added. `No`: they'll
   have to approve tools some other way before `/factory run` works unattended.
2. *Models* — "Keep the default models?" `Yes (Recommended)`: intake on
   Fable, spec-writer/builder/approver on Opus 5.5 (`claude-opus-5-5`),
   reviewers on Haiku/Sonnet by risk, security on Opus. `Change them` → ask
   which role and which alias (`fable`, `opus`, `sonnet`, `haiku`).

## 3. Install

1. Write the answers to a scratch file (your scratchpad, not the project):

   ```json
   {
     "name": "<folder name unless the user named it>",
     "backlog": "local|github",
     "github_repo": "owner/name or null",
     "merge": "pr|local",
     "base_branch": "main",
     "concurrency": 3,
     "max_rounds": 4,
     "surfaces": {"ui": "...", "security": "..."},
     "reviewers": [{"name": "code-reviewer", "purpose": "...", "model": {"low": "haiku", "medium": "sonnet", "high": "sonnet"}, "when": "always", "focus": "- ...\n- ..."}],
     "checks": ["npm run lint", "npm test"],
     "models": {"intake": "fable", "spec-writer": "opus", "builder": "opus", "approver": "opus"},
     "permissions": true
   }
   ```

2. `python3 <base>/install.py --project <project> --answers <file> --dry-run`
   and show the user the file list. Add `--force` only if they chose to update
   an existing install.
3. Run it again without `--dry-run`. It writes `.claude/skills/factory/`,
   `.claude/agents/` (four fixed agents plus one per reviewer, stamped from
   the reviewer template), `factory/bin/`, `factory/config.json`,
   `factory/checks.sh`, `factory/backlog/EXAMPLE.md` (local backlog),
   adds `factory/jobs/` and `factory/worktrees/` to `.gitignore`, and
   registers the project in `~/.claude/factory/registry.json`.
4. Run `bash -n factory/checks.sh` and `factory/bin/route medium ui` (or
   another surface you configured) as a smoke test, and show the routing.

## 4. After install

- Project settings only apply in a **trusted** folder. If the user has never
  opened Claude Code interactively in this project, tell them to do it once
  and accept the trust dialog before `/factory run`.
- **GitHub backlog**: the `factory` label must exist. Creating it changes the
  repo, so ask first, then `gh label create factory --color 0E8A16
  --description "Run by the software factory"`. `factory:needs-human` is
  created on first use.
- **Local merge**: the base branch needs at least one commit.
- **Not a git repository**: the factory needs git (worktrees and branches).
  Say so and offer `git init` plus an initial commit; don't do it unasked.
- Offer to commit the installed files on the base branch (ask; never push).
  Job branches are cut from the base, and `protected_paths` keep them from
  changing the factory's own files.
- Tell the user how to start: add a backlog item (`factory/backlog/*.md` with
  `status: ready`, or label an issue `factory`), then run `/factory run` in a
  Claude Code session in the project. `/factory status` lists jobs;
  `/factory <words>` sends feedback, approves or rejects.
