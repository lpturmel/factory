// All factories (DESIGN.md §3.2).
import { For, Show, createMemo } from "solid-js";
import { useLive } from "../data/live.tsx";
import type { ApiFactory } from "../shared/contract.ts";
import { YOUR_MOVE, attentionItems, isActive, lastWrite, runState, spend7d, throughput7d, usd, type RunState } from "../shared/derive.ts";
import { DecisionCards, SectionTitle, WatchList } from "../components/attention.tsx";
import { Ago, Badge, Kpi, PipelineStrip, RunBadge, Sparkline } from "../components/ui.tsx";
import { EmptyRegistry, LoadingOverview, RegistryError } from "../components/states.tsx";

const RANK: Record<RunState, number> = { error: 0, stopped: 2, running: 3, idle: 4 };

export default function Overview() {
  const live = useLive();
  const items = createMemo(() => attentionItems(live.factories()));
  const mine = createMemo(() => items().filter((i) => YOUR_MOVE.includes(i.kind)));
  const watch = createMemo(() => items().filter((i) => !YOUR_MOVE.includes(i.kind)));

  const rows = createMemo(() => {
    const now = live.now();
    return live.factories().map((f) => {
      const state = runState(f, now);
      const attn = items().filter((i) => i.factory === f.name);
      const tp = throughput7d(f.jobs, now);
      return { f, state, attn, tp, spend: spend7d(f.jobs, now), last: lastWrite(f), active: f.jobs.filter((j) => isActive(j.stage)).length };
    }).sort((a, b) => {
      const ra = a.attn.length && a.state !== "error" ? 1 : RANK[a.state];
      const rb = b.attn.length && b.state !== "error" ? 1 : RANK[b.state];
      return ra - rb || (b.last || 0) - (a.last || 0);
    });
  });

  const totals = createMemo(() => rows().reduce((t, r) => ({
    merged: t.merged + r.tp.merged, rejected: t.rejected + r.tp.rejected, spend: t.spend + r.spend,
    running: t.running + (r.state === "running" ? 1 : 0), inFlight: t.inFlight + (r.state === "running" ? r.active : 0),
  }), { merged: 0, rejected: 0, spend: 0, running: 0, inFlight: 0 }));

  return (
    <Show when={live.settled()} fallback={<LoadingOverview />}>
      <Show when={live.registry()} fallback={<RegistryError />}>
        <Show when={live.factories().length} fallback={<EmptyRegistry />}>
          <div class="head">
            <div>
              <h1>All factories</h1>
              <div class="sub">
                <span>{live.factories().length} registered</span>
                <span>{totals().running} running · {totals().inFlight} jobs in flight</span>
                <span class="mono faint">{live.registry()!.registryPath}</span>
              </div>
            </div>
          </div>

          <section class="kpis" aria-label="Totals">
            <Kpi tone={mine().length ? "attn" : undefined} label="Your move" value={mine().length} sub="blocked until you decide" delay={1} />
            <Kpi tone={watch().length ? "warn" : undefined} label="Watch" value={watch().length} sub="stuck or waiting on an author" delay={2} />
            <Kpi tone="run" label="In flight" value={totals().inFlight} sub={`across ${totals().running} running ${totals().running === 1 ? "factory" : "factories"}`} delay={3} />
            <Kpi tone="ok" label="Merged · 7 days" value={totals().merged} sub={`${totals().rejected} rejected`} delay={4} />
            <Kpi label="Spend · 7 days" value={usd(totals().spend)} sub="API-equivalent" delay={5} />
          </section>

          <section id="your-move" aria-labelledby="ymH">
            <SectionTitle id="ymH" title="Your move" count={mine().length} tone="attn" hint="Blocked until you decide · oldest first" />
            <Show when={mine().length} fallback={<div class="clear-move" role="status"><span aria-hidden="true">✓</span> Nothing is blocked on you.</div>}>
              <DecisionCards items={mine()} />
            </Show>
          </section>

          <Show when={watch().length}>
            <section aria-labelledby="wH">
              <SectionTitle id="wH" title="Watch" count={watch().length} tone="warn" hint="Not your move yet · may become one" />
              <WatchList items={watch()} />
            </section>
          </Show>

          <section aria-labelledby="fH">
            <SectionTitle id="fH" title="Factories" hint="Sorted: needs attention, then most recent" />
            <div class="ftable f-table">
              <table>
                <caption class="sr-only">Registered factories</caption>
                <thead><tr>
                  <th class="label" scope="col">Factory</th><th class="label" scope="col">Status</th><th class="label" scope="col">Pipeline now</th>
                  <th class="label" scope="col">Waiting on you</th><th class="label r" scope="col">Merged 7d</th><th class="label r" scope="col">Spend 7d</th><th class="label r" scope="col">Last activity</th>
                </tr></thead>
                <tbody>
                  <For each={rows()} keyed={(r) => r.f.name}>
                    {(r, i) => <FactoryRow row={r()} index={i()} />}
                  </For>
                </tbody>
              </table>
            </div>
            <div class="f-cards">
              <For each={rows()} keyed={(r) => r.f.name}>
                {(r) => (
                  <a class="jcard f-card" href={`/f/${encodeURIComponent(r().f.name)}`} style={{ "box-shadow": `inset 4px 0 0 ${rail(r().state, r().attn.length)}, var(--glow)` }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                      <span class="fname">{r().f.name}</span><RunBadge state={r().state} /><span class="spacer" />
                      <span class="faint num" style={{ "font-size": "12.5px" }}><Show when={r().last}><Ago t={r().last} /></Show></span>
                    </div>
                    <div class="muted" style={{ "margin-top": "6px", "font-size": "13px" }}>
                      <Show when={r().f.status === "ok"} fallback={r().f.error}>
                        {waitingText(r().attn)}{r().tp.merged} merged · {usd(r().spend)}
                      </Show>
                    </div>
                  </a>
                )}
              </For>
            </div>
          </section>
        </Show>
      </Show>
    </Show>
  );
}

const rail = (state: RunState, attn: number) => (state === "error" || attn ? "var(--attn)" : state === "stopped" ? "var(--stale)" : state === "running" ? "var(--run)" : "var(--line2)");

function waitingText(attn: { kind: string }[]): string {
  const mine = attn.filter((a) => a.kind !== "gate" && a.kind !== "needs-info").length;
  const watch = attn.length - mine;
  return `${mine ? `▲ ${mine} · ` : ""}${watch ? `◆ ${watch} · ` : ""}`;
}

interface Row {
  f: ApiFactory; state: RunState; attn: ReturnType<typeof attentionItems>; tp: ReturnType<typeof throughput7d>; spend: number; last: number; active: number;
}

function FactoryRow(props: { row: Row; index: number }) {
  const href = () => `/f/${encodeURIComponent(props.row.f.name)}`;
  const sub = () => {
    const r = props.row, f = r.f;
    if (r.state === "error") return f.status === "missing" ? "path not found" : "can't read config";
    if (r.state === "running") return `${r.active} of ${f.config?.concurrency ?? f.run?.concurrency ?? "?"} slots`;
    if (r.state === "stopped") return `${r.active} open ${r.active === 1 ? "job" : "jobs"} · quiet`;
    return "queue empty";
  };
  const mine = () => props.row.attn.filter((a) => a.kind === "max-rounds" || a.kind === "escalated" || a.kind === "unreadable").length;
  const watch = () => props.row.attn.length - mine();
  return (
    <tr class={`d${Math.min(5, props.index + 1)}`} onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) location.assign(href()); }}>
      <td>
        <div style={{ display: "flex", gap: "12px", "align-items": "stretch" }}>
          <span class="rail" style={{ background: rail(props.row.state, props.row.attn.length) }} aria-hidden="true" />
          <div>
            <a class="fname" href={href()}>{props.row.f.name}</a>
            <div class="fpath">{props.row.f.displayPath} · {props.row.f.backlog === "github" ? `GitHub ${props.row.f.repo ?? ""}` : "local backlog"} · merge {props.row.f.merge}</div>
          </div>
        </div>
      </td>
      <td><RunBadge state={props.row.state} /><div class="faint" style={{ "font-size": "12.5px", "margin-top": "4px" }}>{sub()}<Show when={props.row.last}> · <Ago t={props.row.last} /> ago</Show></div></td>
      <td>
        <Show when={props.row.f.status === "ok"} fallback={<span class="err-text">{props.row.f.error}</span>}>
          <Show when={props.row.f.jobs.some((j) => j.stage !== "merged" && j.stage !== "rejected")} fallback={<span class="faint">nothing open</span>}>
            <PipelineStrip factory={props.row.f} />
          </Show>
        </Show>
      </td>
      <td>
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
          <Show when={mine()}><Badge tone="attn">▲ {mine()}</Badge></Show>
          <Show when={watch()}><Badge tone="warn">◆ {watch()}</Badge></Show>
          <Show when={!props.row.attn.length}><span class="faint">—</span></Show>
        </div>
      </td>
      <td class="r"><div style={{ display: "flex", "align-items": "flex-end", "justify-content": "flex-end", gap: "10px" }}><Sparkline days={props.row.tp.days} /><span class="bignum">{props.row.f.status === "ok" ? props.row.tp.merged : "—"}</span></div></td>
      <td class="r"><span class="bignum">{props.row.f.status === "ok" ? usd(props.row.spend) : "—"}</span></td>
      <td class="r muted num"><Show when={props.row.last} fallback="—"><Ago t={props.row.last} /> ago</Show></td>
    </tr>
  );
}
