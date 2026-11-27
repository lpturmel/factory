# factory

A per-project **software factory** for Claude Code: a fixed pipeline that
turns a backlog into merged code. Scripts do the deterministic parts (state,
routing, checks, merging); agents do the judgment (is it worth building,
what exactly, the code, is it good). Every stage leaves a file behind that
opens with a short summary, so you can see what happened and why.

```
backlog → intake (fable) → route → spec-writer (opus) → builder (opus)
        → gate (checks.sh) → reviewers (routed, parallel) → approver (opus) → merge
```

This repo holds:

| Path | What |
|---|---|
| `skills/factory-onboard/` | The onboarding skill: interviews you and installs a factory into a project (`install.py` does the stamping). |
| `templates/` | Everything that gets installed into a project, at the same paths: the `/factory` orchestrator skill, the agents (one reviewer template stamped per configured reviewer), `factory/bin/{job,gate,route,backlog,builder-check}`, `factory/config.json`, `factory/checks.sh`. |
| `docs/reference-design.md` | The design this implements, and the tweaks for this repo. |
| `docs/state-contract.md` | Exact formats of `registry.json`, `job.json` and the per-stage files. The contract with the dashboard. |
| `ui/` | The dashboard that shows every registered factory's progress. |

## Install the onboarding skill

Symlink it (don't copy: the skill finds `templates/` through the link):

```bash
mkdir -p ~/.claude/skills
```

```bash
ln -s "$(pwd)/skills/factory-onboard" ~/.claude/skills/factory-onboard
```

Run both from the root of this repo.

## Onboard a project

In a Claude Code session inside the project, run `/factory-onboard`. It asks
where the backlog lives (local `factory/backlog/*.md` or GitHub issues
labeled `factory`), how to merge (PR via `gh pr merge`, or a local
integration fast-forward), which reviewers to run and when, concurrency, max
rounds, and which check commands go in `factory/checks.sh`. Then it installs
the files, gitignores `factory/jobs/` and `factory/worktrees/`, and adds the
project to `~/.claude/factory/registry.json`.

Then, in that project: add a backlog item and run `/factory run`.
Run `/factory` from a Claude Code session opened in the project's main
checkout, not in a worktree session: project permissions only apply there,
and `factory/bin/job sync` refuses to start anywhere else.
`/factory run <id>` drives just one job (a job id or backlog ref);
`/factory status` lists jobs; `/factory approve <id>` approves a job waiting on
you; `/factory reject <id> <why>` rejects one; `/factory <anything else>` sends
feedback to a job's builder.

## Requirements

Git, Python 3 (stdlib only), bash, Claude Code. GitHub backlog or PR merge
mode also needs the `gh` CLI, authenticated.
