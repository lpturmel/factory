# Factory dashboard

A read-only dashboard for every factory in `~/.claude/factory/registry.json`. It has three views:
- **All factories:** what's blocked on you, what's stuck, and each factory's pipeline, throughput and spend.
- **One factory:** a 4-column board grouped by who acts next.
- **One job:** a timeline with folded rounds, gate log tails, reviewer verdicts, cost by agent, and every stage file one click away.

Built with SolidJS 2.0 and Vite, run with Bun. The design and spec are in [`design/`](design/DESIGN.md).

## Run it

Requires [Bun](https://bun.sh) 1.2 or newer.

```bash
bun install
```

Run against your real registry (`~/.claude/factory/registry.json`):

```bash
bun run dev
```

Or run against generated demo data (five factories in varied states, including a game project with a `gameplay-reviewer`):

```bash
bun run demo
```

Then open http://127.0.0.1:5173.

Build once and serve the app and the API from one process on http://127.0.0.1:4317:

```bash
bun start
```

### Start at login (macOS)

```bash
bun run login:install
```

This builds the app and installs a LaunchAgent (`~/Library/LaunchAgents/dev.factory.dashboard.plist`).
- **What runs:** the agent runs `bun server/reader.ts` from this folder whenever you log in, and restarts it if it crashes.
- **Where:** the dashboard is then always at http://127.0.0.1:4317.
- **Log:** `~/Library/Logs/factory-dashboard.log`.
- **After pulling changes:** re-run `login:install` to rebuild and restart.
- **Settings:** `FACTORY_REGISTRY` and `READER_PORT`, if set when you install, are baked into the agent.

```bash
bun run login:status
```

```bash
bun run login:uninstall
```

| Env var | Default | Meaning |
|---|---|---|
| `FACTORY_REGISTRY` | `~/.claude/factory/registry.json` | Registry to read. Relative project paths resolve against its folder. |
| `READER_PORT` | `4317` | Port of the local reader. |
| `PORT` | `5173` | Vite dev server port (dev only). |

## How it works

```
browser (Solid app)  ──/api/*──▶  server/reader.ts  ──reads──▶  registry.json
        ▲                              │                         <project>/factory/config.json, run.json
        └──── server-sent events ◀─────┘ fs.watch                <project>/factory/jobs/<id>/*
```

**The reader.** `server/reader.ts` is a dependency-free server (Bun, using its Node-compatible APIs) and the only thing that touches the disk.
- **Strictly local, strictly read-only:**
  - It binds to `127.0.0.1` and answers only `GET`/`HEAD`.
  - It rejects any `Host` other than `127.0.0.1` or `localhost`, which blocks DNS rebinding.
  - It reads only the registry and files under each registered project's `factory/` folder. Job ids and file names are matched against the patterns in `docs/state-contract.md`, and paths are resolved with `realpath`, so `../` and symlinks can't escape.
- **Change events:** it watches those folders and pushes change events over server-sent events.
- **Production build:** it also serves the built `dist/`.

**The app.** `src/data/live.tsx` holds the registry and one snapshot per factory in signals.
- **Live updates:** they refresh on each event, with a 5 s poll as a backup (30 s while the tab is hidden).
- **Failed reads:** a failed read keeps the last good data on screen and shows an error bar.

**Shared logic.** Derivations live in `src/shared/` and are shared with the reader: attention ranking, run state, throughput, the review matrix, and stage-file parsing.

Stage files are rendered with `marked` and sanitized with DOMPurify, because they can quote issue text written by anyone.

## Checks

```bash
bun test
```

Runs unit tests for the derivations and parsers, plus reader tests that start the server on generated fixtures and try path traversal, a foreign Host header and a POST.

```bash
bun run typecheck
```

## Layout

| Path | What |
|---|---|
| `server/reader.ts` | Local read-only API, SSE and static server |
| `server/dev.ts` | `bun run dev`: reader + Vite, with `/api` proxied |
| `scripts/login-agent.ts` | `login:install` / `login:status` / `login:uninstall` (macOS LaunchAgent) |
| `src/shared/` | Contract types, stage-file parsing, pure derivations (shared with the reader) |
| `src/data/` | API client, live data and theme providers |
| `src/components/`, `src/screens/` | UI |
| `src/styles/fd.css` | Tokens, components and motion, from the design canvas |
| `test/` | `bun test` suites and the demo fixture generator |
