// Runs the dashboard when you log in (macOS LaunchAgent).
//
//   bun run login:install     build the app, write the LaunchAgent, (re)start it
//   bun run login:status      is it loaded and answering?
//   bun run login:uninstall   stop it and remove the LaunchAgent
//
// The agent runs `bun server/reader.ts` from this folder, which serves the built app
// and the read-only API on http://127.0.0.1:$READER_PORT (default 4317). It restarts
// if it crashes. Re-run `login:install` after pulling changes, to rebuild and restart.
// FACTORY_REGISTRY and READER_PORT, if set when you install, are baked into the agent.
// The working directory is "/" on purpose: under launchd, a process whose cwd is inside
// the project folder blocked forever in getcwd() at startup. The reader uses absolute paths.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";

const LABEL = "dev.factory.dashboard";
const root = join(import.meta.dir, "..");
const plistPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const logPath = join(homedir(), "Library", "Logs", "factory-dashboard.log");
const port = process.env.READER_PORT ?? "4317";
const domain = `gui/${userInfo().uid}`;
const url = `http://127.0.0.1:${port}/`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function plist(): string {
  const env: Record<string, string> = {
    READER_PORT: port,
    PATH: `${join(homedir(), ".bun", "bin")}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
  };
  if (process.env.FACTORY_REGISTRY) env.FACTORY_REGISTRY = process.env.FACTORY_REGISTRY;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(process.execPath)}</string>
    <string>${esc(join(root, "server", "reader.ts"))}</string>
  </array>
  <key>WorkingDirectory</key><string>/</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${k}</key><string>${esc(v)}</string>`).join("\n")}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${esc(logPath)}</string>
  <key>StandardErrorPath</key><string>${esc(logPath)}</string>
</dict>
</plist>
`;
}

function launchctl(...args: string[]): { code: number; out: string } {
  const p = Bun.spawnSync(["launchctl", ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? 1, out: p.stdout.toString() + p.stderr.toString() };
}

async function answering(tries = 30): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
    await Bun.sleep(200);
  }
  return false;
}

async function install(): Promise<void> {
  console.log("Building the app…");
  const build = Bun.spawnSync(["bun", "run", "build"], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) throw new Error("build failed");

  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  mkdirSync(join(homedir(), "Library", "Logs"), { recursive: true });
  launchctl("bootout", `${domain}/${LABEL}`); // fine if it wasn't loaded
  writeFileSync(plistPath, plist());
  const boot = launchctl("bootstrap", domain, plistPath);
  if (boot.code !== 0) throw new Error(`launchctl bootstrap failed: ${boot.out.trim()}`);
  launchctl("kickstart", "-k", `${domain}/${LABEL}`);

  if (await answering()) console.log(`Installed. The dashboard starts at login and is running now: ${url}`);
  else console.log(`Installed, but ${url} isn't answering yet. Check ${logPath}`);
  console.log(`LaunchAgent: ${plistPath}\nLog: ${logPath}`);
}

async function status(): Promise<void> {
  const p = launchctl("print", `${domain}/${LABEL}`);
  if (p.code !== 0) { console.log("Not installed (no LaunchAgent loaded). Run: bun run login:install"); return; }
  const state = /state = (\S+)/.exec(p.out)?.[1] ?? "unknown";
  const pid = /pid = (\d+)/.exec(p.out)?.[1];
  console.log(`LaunchAgent ${LABEL}: ${state}${pid ? ` (pid ${pid})` : ""}`);
  console.log(`${url}: ${(await answering(3)) ? "answering" : "not answering"}`);
  console.log(`Log: ${logPath}`);
}

function uninstall(): void {
  launchctl("bootout", `${domain}/${LABEL}`);
  if (existsSync(plistPath)) rmSync(plistPath);
  console.log(`Removed. The dashboard no longer starts at login. (Log kept at ${logPath})`);
}

if (platform() !== "darwin") {
  console.error("Login start is set up with a macOS LaunchAgent; this machine isn't macOS.");
  process.exit(1);
}

const cmd = process.argv[2];
if (cmd === "install") await install();
else if (cmd === "uninstall") uninstall();
else if (cmd === "status") await status();
else { console.error("usage: bun scripts/login-agent.ts install|status|uninstall"); process.exit(1); }
