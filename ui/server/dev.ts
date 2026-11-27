// `bun run dev`: starts the read-only reader and the Vite dev server (which proxies /api to it).
//   FACTORY_REGISTRY=…  read another registry (`bun run demo` points it at ui/.demo)
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const env = { ...process.env, READER_PORT: process.env.READER_PORT ?? "4317" };

const reader = Bun.spawn(["bun", "server/reader.ts"], { cwd: root, env, stdio: ["inherit", "inherit", "inherit"] });
const vite = Bun.spawn(["bun", "--bun", "vite"], { cwd: root, env, stdio: ["inherit", "inherit", "inherit"] });

const stop = () => { reader.kill(); vite.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const first = await Promise.race([reader.exited.then((c) => ["reader", c] as const), vite.exited.then((c) => ["vite", c] as const)]);
if (first[1]) console.error(`${first[0]} exited (${first[1]})`);
stop();
process.exit(first[1] ?? 0);
