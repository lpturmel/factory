// Runs the reader against freshly generated demo fixtures and checks its read-only, local-only boundary.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 4300 + Math.floor(Math.random() * 500);
const root = join(import.meta.dirname, "..");
const home = mkdtempSync(join(tmpdir(), "factory-demo-"));
let reader: ChildProcess;

function get(path: string, headers: Record<string, string> = {}, method = "GET"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  execFileSync("bun", [join(root, "test/fixtures/generate.mjs"), home]);
  reader = spawn("bun", ["server/reader.ts"], {
    cwd: root, env: { ...process.env, FACTORY_REGISTRY: join(home, "registry.json"), READER_PORT: String(PORT) }, stdio: "pipe",
  });
  for (let i = 0; i < 50; i++) {
    try { await get("/api/registry"); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("reader did not start");
});

afterAll(() => { reader?.kill(); rmSync(home, { recursive: true, force: true }); });

describe("reader", () => {
  it("lists the registry with existence flags", async () => {
    const r = JSON.parse((await get("/api/registry")).body);
    expect(r.projects.map((p: { name: string }) => p.name)).toContain("tidepool");
    expect(r.projects.find((p: { name: string }) => p.name === "docs-site").exists).toBe(false);
  });

  it("returns a factory snapshot with the attention question attached", async () => {
    const f = JSON.parse((await get("/api/factories/tidepool")).body);
    expect(f.status).toBe("ok");
    const dash = f.jobs.find((j: { id: string }) => j.id === "local-dash-cooldown");
    expect(dash.attentionSummary[0]).toMatch(/0\.35 s/);
  });

  it("reports a missing project as data, not an HTTP error", async () => {
    const r = await get("/api/factories/docs-site");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).status).toBe("missing");
  });

  it("serves job files and log tails", async () => {
    const d = JSON.parse((await get("/api/factories/tidepool/jobs/local-dash-cooldown")).body);
    expect(d.files.map((f: { name: string }) => f.name)).toContain("gate-2.log");
    const tail = JSON.parse((await get("/api/factories/tidepool/jobs/local-dash-cooldown/log/2?tail=2")).body);
    expect(tail.lines).toHaveLength(2);
  });

  it.each([
    "/api/factories/tidepool/jobs/..%2F..%2Fconfig.json",
    "/api/factories/tidepool/jobs/local-dash-cooldown/files/..%2Fjob.json",
    "/api/factories/tidepool/jobs/local-dash-cooldown/files/job.json",
    "/api/factories/tidepool/jobs/local-dash-cooldown/files/%2Fetc%2Fpasswd",
    "/api/factories/tidepool/jobs/local-dash-cooldown/log/..%2F1",
    "/api/factories/nope",
  ])("refuses %s", async (path) => {
    expect((await get(path)).status).toBe(404);
  });

  it("rejects foreign Host headers and writes", async () => {
    expect((await get("/api/registry", { host: "evil.example" })).status).toBe(421);
    expect((await get("/api/registry", {}, "POST")).status).toBe(405);
  });
});
