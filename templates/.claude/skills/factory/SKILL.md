---
name: factory
description: Run this project's software factory. `/factory run` drains the backlog into merged code through intake, spec, build, gate, review and approval. `/factory status` lists jobs. `/factory <anything else>` sends your words to a job's builder, approves it, or rejects it.
argument-hint: run | status | <feedback, approve or reject for a job>
allowed-tools: Bash(factory/bin/job:*), Bash(factory/bin/backlog list), Agent, Read
---

# Factory orchestrator

You are the one orchestrator for every job in this project's factory. You
start jobs, spawn every agent as a background subagent, and call the
scripts. **You write nothing yourself**: no Write, no Edit, no git, no
comments on issues. Every fact lives in `factory/jobs/<id>/`, and
`factory/bin/job` is the only thing that changes it. Your context stays small
because agents reply with one line and the scripts print one line; don't
read agent files unless the user asks or something is wrong.

Run every command from the project root (the main checkout). Never `cd` into a
worktree.

## Arguments: `$ARGUMENTS`

- `run` (or empty) → [Run](#run).
- `status` → run `factory/bin/job list --all` and show it as a short table
  (id, stage, round, note). Stop.
- anything else → [Talk to a job](#talk-to-a-job).

## Run

1. `factory/bin/job sync` — starts new jobs from the backlog up to
   `concurrency` and prints `<id> <stage>` for every open job. This is also
   how a fresh session resumes: whatever is in `factory/jobs/` continues from
   its stage.
2. For every printed job that has **no agent of yours still running**, run
   `factory/bin/job next <id>`. It does the deterministic work for that stage
   (routing, worktree, push, draft PR, gate, merge) and prints one line.
   `next` can take minutes when it runs the gate; run it with
   `run_in_background` when other jobs are waiting on you.
3. Act on the line:
   - `<id> <stage> SPAWN <agent>:<model> [<agent>:<model> ...] out=<f>[,<f>...]`
     → spawn each listed agent **in the background**, all at once (reviewers
     run in parallel), using the Agent tool with `subagent_type` = agent,
     `model` = model, and exactly this prompt (paths absolute, `<n>` from
     `factory/bin/job show <id> round` only if you don't already know it):

     ```
     Factory job: <absolute path to factory/jobs/<id>>
     Agent: <agent>
     Round: <n>
     Write: <absolute path to factory/jobs/<id>/<its out file>>

     Follow your agent instructions. Read job.json first.
     ```

     The first line is how per-job cost is attributed; never change it. The
     n-th agent gets the n-th `out` file.
   - `<id> <stage> WAIT <author|human> <note>` → nothing to do for this job now.
   - `<id> <stage> DONE <merged|rejected>` → the job is finished.
   - `ERROR <id>: <agent> did not write <file>` → the agent was spawned twice
     and its out file still doesn't exist. Stop working that job and tell the
     user. The likely cause is that the agent's Write was denied (for example
     a session running outside the main checkout, or a permission prompt that
     was refused). Don't re-spawn the agent and don't run `job retry` on your
     own; the user decides (see **Retry** below).
   - `ERROR <message>` → stop working that job and tell the user the message.
     Don't try to fix state by hand.
4. When a background agent finishes, note its one-line reply. **Wait for all
   of a job's running agents** (e.g. every reviewer) before calling
   `factory/bin/job next <id>` for that job again; then go to step 3.
5. Whenever a job reaches `WAIT` or `DONE`, run `factory/bin/job sync` again
   so a freed slot starts the next backlog item, and `next` any new job.
6. Stop when no agent of yours is running, every open job is `WAIT` or
   `ERROR`, and `sync` started nothing new. Report a short table: each job,
   its stage, and what it waits on (for `needs-human`, the note and the PR
   link from `factory/bin/job show <id> pr`). Mention that the user can reply
   with `/factory <feedback>`, `/factory approve <id>` or `/factory reject <id> <why>`.

Never spawn the same agent for the same job and output file twice. If you
lost track after a compaction, check your running background tasks before
re-spawning anything `next` asks for.

## Talk to a job

The user's words are about one job. Find it from `factory/bin/job list --all`
by id, issue number or title. If more than one open job could match, ask
with AskUserQuestion which one. Then decide what they want:

- **Feedback** (change something, fix something, a different approach):
  pass their words verbatim on stdin:

  ```bash
  factory/bin/job feedback <id> <<'FACTORY_EOF'
  <the user's words, unedited>
  FACTORY_EOF
  ```

  If it prints `SPAWN`, spawn the builder as in Run step 3 and continue the
  run loop for that job. If it prints `OK … recorded`, the builder of the
  next round reads it.
- **Approve** a `needs-human` job ("merge it", "approve", "ship it"):
  `factory/bin/job approve <id>`, then act on its line.
- **Reject** ("drop", "reject", "won't do"): pass their reason the same way
  to `factory/bin/job reject <id>`. The reason goes on the issue, the PR
  closes, the job is done.
- **Retry** ("retry", "try again", typically after a `did not write` ERROR):
  `factory/bin/job retry <id>`, then `factory/bin/job next <id>`, and act on
  its line as in Run step 3.

If it's unclear whether they mean feedback or reject, ask. Never add your
own words to theirs.
