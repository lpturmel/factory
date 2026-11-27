// Local, read-only reader for the factory dashboard (DESIGN.md §8.3).
//
// Serves the registry, each factory's config and jobs, job files and log tails as
// JSON, pushes change events over server-sent events, and (when ui/dist exists)
// serves the built app. It binds to 127.0.0.1 only, accepts only GET/HEAD, checks
// the Host header (no DNS rebinding), and reads nothing outside the registry file
// and each registered project's factory/ folder.
//
// Run: bun server/reader.ts
// Env: FACTORY_REGISTRY (default ~/.claude/factory/registry.json), READER_PORT (default 4317)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { readFile, readdir, stat, realpath, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ApiEvent, ApiFactory, ApiFileContent, ApiJob, ApiJobDetail, ApiJobFile, ApiLogTail, ApiRegistry,
  ConfigSubset, JobJson, RegistryFile, RegistryProject, RunFile,
} from "../src/shared/contract.ts";
import { JOB_FILE_PATTERN, JOB_ID_PATTERN, compareFiles, parseStageFile } from "../src/shared/parse.ts";
import { attentionFile, attentionKind } from "../src/shared/derive.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.READER_PORT ?? 4317);
const REGISTRY = resolve(process.env.FACTORY_REGISTRY ?? join(homedir(), ".claude", "factory", "registry.json"));
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const MAX_FILE_BYTES = 1_000_000;

// ---------- reading ----------

class NotFound extends Error {}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Resolves `child` under `root` and refuses anything that escapes it, symlinks included. */
async function inside(root: string, ...parts: string[]): Promise<string> {
  const target = resolve(root, ...parts);
  const realRoot = await realpath(root);
  let realTarget: string;
  try { realTarget = await realpath(target); } catch { throw new NotFound(); }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) throw new NotFound();
  return realTarget;
}

const tilde = (abs: string) => { const h = homedir(); return abs === h || abs.startsWith(h + sep) ? "~" + abs.slice(h.length) : abs; };

function projectPath(p: RegistryProject): string {
  return isAbsolute(p.path) ? p.path : resolve(dirname(REGISTRY), p.path);
}

async function loadRegistry(): Promise<{ registryPath: string; projects: RegistryProject[] }> {
  const file = await readJson<RegistryFile>(REGISTRY);
  const projects = Array.isArray(file.projects) ? file.projects.filter((p) => p && typeof p.name === "string" && typeof p.path === "string") : [];
  return { registryPath: REGISTRY, projects };
}

async function apiRegistry(): Promise<ApiRegistry> {
  const reg = await loadRegistry();
  return {
    registryPath: tilde(reg.registryPath),
    projects: reg.projects.map((p) => ({ ...p, exists: existsSync(join(projectPath(p), "factory")) })),
  };
}

async function findProject(name: string): Promise<RegistryProject> {
  const reg = await loadRegistry();
  const p = reg.projects.find((x) => x.name === name);
  if (!p) throw new NotFound();
  return p;
}

const jobsDir = (p: RegistryProject) => join(projectPath(p), "factory", "jobs");

async function summaryOf(dir: string, name: string): Promise<string[] | undefined> {
  try { return parseStageFile(await readFile(join(dir, name), "utf8")).summary; } catch { return undefined; }
}

async function apiFactory(p: RegistryProject): Promise<ApiFactory> {
  const base: ApiFactory = {
    name: p.name, path: projectPath(p), displayPath: tilde(projectPath(p)), status: "ok", error: null,
    backlog: p.backlog, merge: p.merge, repo: p.repo ?? null,
    config: null, run: null, jobs: [], readErrors: [], readAt: new Date().toISOString(),
  };
  const factoryDir = join(projectPath(p), "factory");
  if (!existsSync(factoryDir)) {
    return { ...base, status: "missing", error: `${tilde(projectPath(p))} is in the registry but ${existsSync(projectPath(p)) ? "has no factory/ folder" : "the folder is gone"}. Moved it? Update registry.json or re-run onboarding there.` };
  }
  try {
    const c = await readJson<ConfigSubset & Record<string, unknown>>(join(factoryDir, "config.json"));
    base.config = { name: c.name, backlog: c.backlog, merge: c.merge, concurrency: c.concurrency, max_rounds: c.max_rounds, reviewers: Array.isArray(c.reviewers) ? c.reviewers.map((r) => ({ name: String((r as { name: unknown }).name) })) : undefined };
  } catch (e) {
    return { ...base, status: "unreadable", error: `factory/config.json: ${(e as Error).message}` };
  }
  try { base.run = await readJson<RunFile>(join(factoryDir, "run.json")); } catch { /* optional */ }

  const dir = jobsDir(p);
  let ids: string[] = [];
  try { ids = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && JOB_ID_PATTERN.test(d.name)).map((d) => d.name); } catch { /* no jobs yet */ }
  await Promise.all(ids.map(async (id) => {
    const jdir = join(dir, id);
    try {
      const job = await readJson<JobJson>(join(jdir, "job.json"));
      const out: ApiJob = job;
      const kind = attentionKind(job);
      if (kind) {
        const f = attentionFile(job, kind);
        if (f) out.attentionSummary = await summaryOf(jdir, f);
      }
      base.jobs.push(out);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") base.readErrors.push({ id, message: (e as Error).message });
    }
  }));
  base.jobs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return base;
}

async function apiJob(p: RegistryProject, id: string): Promise<ApiJobDetail> {
  if (!JOB_ID_PATTERN.test(id)) throw new NotFound();
  const jdir = await inside(jobsDir(p), id);
  const job = await readJson<JobJson>(join(jdir, "job.json"));
  const names = (await readdir(jdir)).filter((n) => JOB_FILE_PATTERN.test(n)).sort(compareFiles);
  const files: ApiJobFile[] = await Promise.all(names.map(async (name) => {
    const st = await stat(join(jdir, name));
    const parsed = name.endsWith(".md") && st.size < MAX_FILE_BYTES ? parseStageFile(await readFile(join(jdir, name), "utf8")) : { summary: [], verdicts: {} };
    return { name, summary: parsed.summary, verdicts: parsed.verdicts, mtime: st.mtime.toISOString(), size: st.size };
  }));
  return { factory: p.name, path: projectPath(p), job, files };
}

async function readCapped(path: string, from: "start" | "end"): Promise<{ text: string; truncated: boolean }> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, MAX_FILE_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, from === "end" ? size - len : 0);
    return { text: buf.toString("utf8"), truncated: size > len };
  } finally { await fh.close(); }
}

async function apiFile(p: RegistryProject, id: string, name: string): Promise<ApiFileContent> {
  if (!JOB_ID_PATTERN.test(id) || !JOB_FILE_PATTERN.test(name)) throw new NotFound();
  const path = await inside(jobsDir(p), id, name);
  const { text, truncated } = await readCapped(path, name.endsWith(".log") ? "end" : "start");
  return { name, kind: name.endsWith(".log") ? "log" : "md", text, truncated };
}

async function apiLogTail(p: RegistryProject, id: string, round: string, lines: number): Promise<ApiLogTail> {
  if (!/^\d{1,4}$/.test(round)) throw new NotFound();
  const name = `gate-${round}.log`;
  const f = await apiFile(p, id, name);
  const all = f.text.replace(/\s+$/, "").split(/\r?\n/);
  return { name, lines: all.slice(-Math.max(1, Math.min(lines, 400))) };
}

// ---------- change events (SSE) ----------

const clients = new Set<ServerResponse>();
const pending = new Map<string, ApiEvent>();
let flushTimer: NodeJS.Timeout | null = null;

function emit(ev: ApiEvent): void {
  const key = ev.type === "factory" ? `f:${ev.name}:${ev.jobId ?? ""}` : ev.type;
  pending.set(key, ev);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = [...pending.values()];
    pending.clear();
    for (const res of clients) for (const e of batch) res.write(`data: ${JSON.stringify(e)}\n\n`);
  }, 250);
}

let watchers: FSWatcher[] = [];

async function rewatch(): Promise<void> {
  for (const w of watchers) w.close();
  watchers = [];
  try {
    watchers.push(watch(dirname(REGISTRY), (_ev, file) => {
      if (!file || String(file) === "registry.json" || String(file).endsWith(".json")) { emit({ type: "registry" }); void rewatch(); }
    }));
  } catch { /* registry folder missing: the registry endpoint reports it */ }
  let projects: RegistryProject[] = [];
  try { projects = (await loadRegistry()).projects; } catch { return; }
  for (const p of projects) {
    const fdir = join(projectPath(p), "factory");
    if (!existsSync(fdir)) continue;
    try {
      watchers.push(watch(fdir, { recursive: true }, (_ev, file) => {
        const rel = String(file ?? "").split(/[\\/]/);
        if (rel[0] === "worktrees" || rel[0] === "backlog") return;
        const jobId = rel[0] === "jobs" && rel[1] && JOB_ID_PATTERN.test(rel[1]) ? rel[1] : undefined;
        emit({ type: "factory", name: p.name, jobId });
      }));
    } catch { /* unwatchable: the client's poll still covers it */ }
  }
}

// ---------- HTTP ----------

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".ico": "image/x-icon",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (!existsSync(DIST)) { res.writeHead(404, { "content-type": "text/plain" }); res.end("No build. Run `bun run build` (or `bun run login:install`), or use `bun run dev`."); return; }
  let file: string;
  try {
    file = await inside(DIST, "." + decodeURIComponent(pathname));
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch { file = join(DIST, "index.html"); }
  if (!existsSync(file)) file = join(DIST, "index.html");
  const body = await readFile(file);
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  const host = (req.headers.host ?? "").toLowerCase();
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { res.writeHead(421); res.end(); return; }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return; }

  const url = new URL(req.url ?? "/", `http://${host}`);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== "api") return serveStatic(req, res, url.pathname);

  try {
    if (parts.length === 2 && parts[1] === "events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ type: "hello" } satisfies ApiEvent)}\n\n`);
      clients.add(res);
      const ka = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
      req.on("close", () => { clearInterval(ka); clients.delete(res); });
      return;
    }
    if (parts.length === 2 && parts[1] === "registry") return send(res, 200, await apiRegistry());
    if (parts[1] === "factories" && parts[2]) {
      const p = await findProject(parts[2]);
      if (parts.length === 3) return send(res, 200, await apiFactory(p));
      if (parts[3] === "jobs" && parts[4]) {
        if (parts.length === 5) return send(res, 200, await apiJob(p, parts[4]));
        if (parts.length === 7 && parts[5] === "files") return send(res, 200, await apiFile(p, parts[4], parts[6]));
        if (parts.length === 7 && parts[5] === "log") return send(res, 200, await apiLogTail(p, parts[4], parts[6], Number(url.searchParams.get("tail") ?? 40)));
      }
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    if (e instanceof NotFound || (e as NodeJS.ErrnoException).code === "ENOENT") return send(res, 404, { error: "not found" });
    if (e instanceof SyntaxError) return send(res, 502, { error: `parse error: ${e.message}` });
    send(res, 500, { error: (e as Error).message });
  }
}

export function startReader(port = PORT) {
  const server = createServer((req, res) => { void handle(req, res); });
  server.listen(port, HOST, () => {
    console.log(`factory reader on http://${HOST}:${port}  (registry: ${REGISTRY})`);
  });
  void rewatch();
  // The registry may not exist yet (nothing onboarded), or may be replaced wholesale:
  // re-check every 15 s and rewatch when it appears or changes.
  const markOf = async () => { try { const st = await stat(REGISTRY); return `${st.mtimeMs}:${st.size}`; } catch { return "missing"; } };
  let seen: Promise<string> | string = markOf();
  const recheck = setInterval(async () => {
    const mark = await markOf();
    if (mark !== (await seen)) { seen = mark; emit({ type: "registry" }); void rewatch(); }
  }, 15_000);
  server.on("close", () => clearInterval(recheck));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startReader();
