// App-wide live data (DESIGN.md §8.4). Holds the registry and one snapshot per
// factory in plain signals, refreshed by server-sent events from the reader with a
// safety-net poll. A failed read keeps the last good data and sets `error`.
import { createContext, createSignal, onSettled, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ApiEvent, ApiFactory, ApiRegistry } from "../shared/contract.ts";
import { api } from "./api.ts";

export interface Live {
  registry: () => ApiRegistry | null;
  /** Loaded factory snapshots, in registry order. */
  factories: () => ApiFactory[];
  factory: (name: string) => ApiFactory | undefined;
  /** True once the first full read finished (successfully or not). */
  settled: () => boolean;
  lastReadAt: () => number;
  error: () => string | null;
  connected: () => boolean;
  /** Wall clock, ticking every second, for "4s ago". */
  now: () => number;
  /** Change events from the reader (after the provider has applied them). */
  subscribe: (fn: (ev: ApiEvent) => void) => () => void;
  reload: () => void;
}

const LiveContext = createContext<Live>();

export const useLive = (): Live => useContext(LiveContext);

const VISIBLE_POLL = 5_000;
const HIDDEN_POLL = 30_000;

export function LiveProvider(props: { children: JSX.Element }) {
  const [registry, setRegistry] = createSignal<ApiRegistry | null>(null);
  const [snaps, setSnaps] = createSignal<Record<string, ApiFactory>>({});
  const [settled, setSettled] = createSignal(false);
  const [lastReadAt, setLastReadAt] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  const listeners = new Set<(ev: ApiEvent) => void>();

  let running = false;
  let again = false;
  async function loadAll(): Promise<void> {
    if (running) { again = true; return; }
    running = true;
    try {
      const reg = await api.registry();
      const results = await Promise.allSettled(reg.projects.map((p) => api.factory(p.name)));
      const next: Record<string, ApiFactory> = {};
      results.forEach((r, i) => {
        const p = reg.projects[i];
        if (r.status === "fulfilled") next[p.name] = r.value;
        else next[p.name] = {
          name: p.name, path: p.path, displayPath: p.path, status: "unreadable", error: (r.reason as Error).message,
          backlog: p.backlog, merge: p.merge, repo: p.repo, config: null, run: null, jobs: [], readErrors: [], readAt: new Date().toISOString(),
        };
      });
      setRegistry(reg);
      setSnaps(next);
      setError(null);
      setLastReadAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSettled(true);
      running = false;
      if (again) { again = false; void loadAll(); }
    }
  }

  const pendingOne = new Map<string, ReturnType<typeof setTimeout>>();
  function loadOne(name: string): void {
    clearTimeout(pendingOne.get(name));
    pendingOne.set(name, setTimeout(async () => {
      pendingOne.delete(name);
      try {
        const f = await api.factory(name);
        setSnaps((prev) => ({ ...prev, [name]: f }));
        setLastReadAt(Date.now());
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 120));
  }

  onSettled(() => {
    void loadAll();
    const clock = setInterval(() => setNow(Date.now()), 1000);

    let es: EventSource | null = null;
    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);
      es.onmessage = (m) => {
        let ev: ApiEvent;
        try { ev = JSON.parse(m.data) as ApiEvent; } catch { return; }
        if (ev.type === "registry") void loadAll();
        else if (ev.type === "factory") loadOne(ev.name);
        for (const fn of listeners) fn(ev);
      };
    };
    connect();

    let timer: ReturnType<typeof setInterval>;
    const schedule = () => {
      clearInterval(timer);
      timer = setInterval(() => void loadAll(), document.hidden ? HIDDEN_POLL : VISIBLE_POLL);
    };
    const onVisibility = () => { schedule(); if (!document.hidden) void loadAll(); };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(clock);
      clearInterval(timer);
      es?.close();
      document.removeEventListener("visibilitychange", onVisibility);
      for (const t of pendingOne.values()) clearTimeout(t);
    };
  });

  const live: Live = {
    registry,
    factories: () => {
      const reg = registry();
      const s = snaps();
      return reg ? reg.projects.map((p) => s[p.name]).filter((f): f is ApiFactory => !!f) : [];
    },
    factory: (name) => snaps()[name],
    settled,
    lastReadAt,
    error,
    connected,
    now,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    reload: () => void loadAll(),
  };

  return <LiveContext value={live}>{props.children}</LiveContext>;
}

// ---------- theme ----------

export type ThemePref = "system" | "light" | "dark";

export interface Theme {
  pref: () => ThemePref;
  cycle: () => void;
  /** Class for the .fd root: "t-light" or "t-dark". */
  cls: () => string;
}

const ThemeContext = createContext<Theme>();
export const useTheme = (): Theme => useContext(ThemeContext);

export function ThemeProvider(props: { children: JSX.Element }) {
  const read = (): ThemePref => {
    try { const v = localStorage.getItem("factory-theme"); if (v === "light" || v === "dark" || v === "system") return v; } catch { /* storage blocked */ }
    return "system";
  };
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
  const [pref, setPref] = createSignal<ThemePref>(read());
  const [systemLight, setSystemLight] = createSignal(media?.matches ?? false);

  onSettled(() => {
    const on = () => setSystemLight(media?.matches ?? false);
    media?.addEventListener("change", on);
    return () => media?.removeEventListener("change", on);
  });

  const theme: Theme = {
    pref,
    cycle: () => {
      const next: ThemePref = pref() === "system" ? "light" : pref() === "light" ? "dark" : "system";
      setPref(next);
      try { localStorage.setItem("factory-theme", next); } catch { /* storage blocked */ }
    },
    cls: () => (pref() === "light" || (pref() === "system" && systemLight()) ? "t-light" : "t-dark"),
  };
  return <ThemeContext value={theme}>{props.children}</ThemeContext>;
}
