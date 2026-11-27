// One factory: KPIs, attention, 4-phase board or table, done list (DESIGN.md §3.3).
import { For, Show, createMemo, createSignal } from "solid-js";
import type { RouteSectionProps } from "@solidjs/router";
import { useLive } from "../data/live.tsx";
import type { ApiJob } from "../shared/contract.ts";
import { FLOW_STAGES } from "../shared/contract.ts";
import {
  DAY, PHASES, YOUR_MOVE, attentionItems, attentionKind, attentionReason, duration, gateFailStreak, isActive, lastWrite,
  medianMerged, openSpend, phaseOf, runState, spend7d, throughput7d, ts, usd,
} from "../shared/derive.ts";
import { DecisionCards, SectionTitle, WatchList } from "../components/attention.tsx";
import { Ago, Badge, Kpi, Pips, ReviewerChip, RiskMeter, RunBadge, StageBadge, StageTag } from "../components/ui.tsx";
import { NotFound, Spinner } from "../components/states.tsx";

export default function Factory(props: RouteSectionProps) {
  const live = useLive();
  const name = () => props.params.name ?? "";
  const f = createMemo(() => live.factory(name()));
  const [layout, setLayout] = createSignal<"board" | "table">(readLayout());

  const items = createMemo(() => (f() ? attentionItems([f()!]) : []));
  const mine = createMemo(() => items().filter((i) => YOUR_MOVE.includes(i.kind)));
  const watch = createMemo(() => items().filter((i) => !YOUR_MOVE.includes(i.kind)));
  const open = createMemo(() => (f()?.jobs ?? []).filter((j) => j.stage !== "merged" && j.stage !== "rejected"));
  const done = createMemo(() => (f()?.jobs ?? []).filter((j) => (j.stage === "merged" || j.stage === "rejected") && live.now() - ts(j.stage_entered_at) < 7 * DAY)
    .sort((a, b) => ts(b.stage_entered_at) - ts(a.stage_entered_at)));
  const state = createMemo(() => (f() ? runState(f()!, live.now()) : "idle"));
  const tp = createMemo(() => throughput7d(f()?.jobs ?? [], live.now()));
  const median = createMemo(() => medianMerged(f()?.jobs ?? [], live.now()));
  const slots = () => f()?.config?.concurrency ?? f()?.run?.concurrency;
  const active = () => open().filter((j) => isActive(j.stage)).length;

  const pick = (v: "board" | "table") => { setLayout(v); try { localStorage.setItem("factory-layout", v); } catch { /* blocked */ } };

  return (
    <Show when={live.settled()} fallback={<Spinner label="Loading factory" />}>
      <Show when={f()} fallback={<NotFound what={`Factory “${name()}”`} />}>
        <div class="head">
          <div>
            <div style={{ display: "flex", "align-items": "center", gap: "12px", "flex-wrap": "wrap" }}>
              <h1>{f()!.name}</h1><RunBadge state={state()} />
            </div>
            <div class="sub">
              <span class="mono">{f()!.displayPath}</span>
              <span>{f()!.backlog === "github" ? `GitHub ${f()!.repo ?? ""}` : "local backlog"}</span>
              <span>merge: {f()!.merge}</span>
              <Show when={slots()}><span>{active()} of {slots()} slots busy</span></Show>
              <Show when={lastWrite(f()!)}><span>last write <Ago t={lastWrite(f()!)} /> ago</span></Show>
            </div>
          </div>
        </div>

        <Show when={f()!.status !== "ok"}>
          <section class="banner attn" role="alert">
            <span class="siren" aria-hidden="true">✕</span>
            <div><div class="big">{f()!.status === "missing" ? "Factory path not found" : "Can't read this factory"}</div><p style={{ margin: "6px 0 0" }}>{f()!.error}</p></div>
          </section>
        </Show>

        <Show when={f()!.status === "ok"}>
          <Show when={state() === "stopped"}>
            <section class="banner stale" role="status">
              <span class="badge b-stale" style={{ "flex": "none" }}>■ Stopped</span>
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                <div class="big">Quiet for <Ago t={lastWrite(f()!)} /> with {active()} open {active() === 1 ? "job" : "jobs"}</div>
                <div>Jobs are in active stages but no job file changed recently. Stages show where they were left. Run this in the project to resume every job from its stage:</div>
                <span class="cmd" style={{ "align-self": "flex-start" }}>cd {f()!.displayPath} &amp;&amp; claude, then /factory run</span>
              </div>
            </section>
          </Show>
          <Show when={state() === "idle" && !open().length}>
            <section class="banner idle" role="status"><span class="badge b-mute">○ Idle</span><div>The queue is empty. Add a backlog item ({f()!.backlog === "github" ? "an issue labeled factory" : "factory/backlog/*.md with status: ready"}) and run <span class="cmd">/factory run</span>.</div></section>
          </Show>

          <section class="kpis" aria-label={`${f()!.name} totals`}>
            <Kpi tone={mine().length ? "attn" : undefined} label="Your move" value={mine().length} sub={mine().length ? mine().map((m) => m.reason.toLowerCase()).join(", ") : "nothing blocked"} delay={1} />
            <Kpi tone={watch().length ? "warn" : undefined} label="Watch" value={watch().length} sub="gate failing · author asked" delay={2} />
            <Kpi tone="run" label="In flight" value={<>{active()}<Show when={slots()}><span class="faint" style={{ "font-size": "20px" }}> / {slots()}</span></Show></>} sub={state() === "running" ? "slots busy" : "not running"} delay={3} />
            <Kpi tone="ok" label="Merged · 7 days" value={tp().merged} sub={`${tp().rejected} rejected${median() ? ` · median ${duration(median()!.ms)}` : ""}`} delay={4} />
            <Kpi label="Spend · 7 days" value={usd(spend7d(f()!.jobs, live.now()))} sub={`${usd(openSpend(f()!.jobs))} on open jobs`} delay={5} />
          </section>

          <Show when={mine().length}>
            <section aria-labelledby="fymH"><SectionTitle id="fymH" title="Your move" count={mine().length} tone="attn" /><DecisionCards items={mine()} showFactory={false} /></section>
          </Show>
          <Show when={watch().length}>
            <section aria-labelledby="fwH"><SectionTitle id="fwH" title="Watch" count={watch().length} tone="warn" /><WatchList items={watch()} showFactory={false} /></section>
          </Show>

          <section aria-labelledby="pH">
            <div class="sec-title">
              <h2 id="pH">Pipeline</h2><span class="hint">{open().length} open · grouped by who acts next</span><span class="spacer" />
              <div class="seg" role="group" aria-label="Layout">
                <button type="button" aria-pressed={layout() === "board" ? "true" : "false"} onClick={() => pick("board")}>Board</button>
                <button type="button" aria-pressed={layout() === "table" ? "true" : "false"} onClick={() => pick("table")}>Table</button>
              </div>
            </div>
            <Show when={layout() === "board"} fallback={<JobTable jobs={open()} factory={f()!.name} />}>
              <div class="board">
                <For each={PHASES}>
                  {(p) => {
                    const jobs = () => open().filter((j) => phaseOf(j.stage) === p.key);
                    return (
                      <section class={`col ${p.key === "you" && jobs().length ? "attn" : ""}`} aria-label={`${p.name}, ${jobs().length} jobs`}>
                        <div class="col-head"><div><h3>{p.name}</h3><div class="sub">{p.sub}</div></div><span class="n">{jobs().length}</span></div>
                        <For each={jobs()} keyed={(j) => j.id} fallback={<div class="faint col-empty">Nothing here</div>}>
                          {(j) => <JobCard job={j()} factory={f()!.name} />}
                        </For>
                      </section>
                    );
                  }}
                </For>
              </div>
            </Show>
          </section>

          <Show when={done().length}>
            <section aria-labelledby="dH">
              <SectionTitle id="dH" title="Done" hint={`Last 7 days · ${done().filter((j) => j.stage === "merged").length} merged, ${done().filter((j) => j.stage === "rejected").length} rejected`} />
              <div class="ftable">
                <table style={{ "min-width": "700px" }}>
                  <thead><tr><th class="label" scope="col">Job</th><th class="label" scope="col">Title</th><th class="label" scope="col">Result</th><th class="label r" scope="col">Rounds</th><th class="label r" scope="col">Took</th><th class="label r" scope="col">Cost</th><th class="label r" scope="col">When</th></tr></thead>
                  <tbody>
                    <For each={done()} keyed={(j) => j.id}>
                      {(j) => (
                        <tr>
                          <td class="mono"><a href={`/f/${encodeURIComponent(f()!.name)}/j/${encodeURIComponent(j().id)}`}>{j().id}</a></td>
                          <td>{j().title}<Show when={j().stage === "rejected" && j().note}><div class="faint" style={{ "font-size": "12.5px" }}>{j().note}</div></Show></td>
                          <td><StageBadge stage={j().stage} /></td>
                          <td class="r num">{j().round || "—"}</td>
                          <td class="r num">{duration(ts(j().stage_entered_at) - ts(j().created_at))}</td>
                          <td class="r num">{usd(j().cost?.usd)}</td>
                          <td class="r muted"><Ago t={ts(j().stage_entered_at)} /> ago</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

function readLayout(): "board" | "table" {
  try { return localStorage.getItem("factory-layout") === "table" ? "table" : "board"; } catch { return "board"; }
}

const jobHref = (factory: string, id: string) => `/f/${encodeURIComponent(factory)}/j/${encodeURIComponent(id)}`;

function liveVerdict(j: ApiJob, reviewer: string): string | null {
  const v = j.verdicts?.review?.[String(j.round)]?.[reviewer];
  if (v) return v;
  return j.stage === "review" ? "running" : null;
}

export function JobCard(props: { job: ApiJob; factory: string }) {
  const live = useLive();
  const kind = () => attentionKind(props.job);
  const flag = () => (kind() === "max-rounds" || kind() === "escalated" ? "attn" : kind() ? "warn" : "");
  const progress = () => {
    const i = FLOW_STAGES.indexOf(props.job.stage);
    return i < 0 ? null : Math.round(((i + 0.5) / FLOW_STAGES.length) * 100);
  };
  return (
    <a class={`jcard ${flag()}`} href={jobHref(props.factory, props.job.id)}>
      <div class="top">
        <StageTag stage={props.job.stage} stuck={gateFailStreak(props.job) >= 2} />
        <span class="mono">{props.job.id}</span><span class="spacer" /><RiskMeter risk={props.job.risk} />
      </div>
      <div class="ttl">{props.job.title}</div>
      <Show when={props.job.surfaces.length}><div class="row"><For each={props.job.surfaces}>{(s) => <span class="chip">{s}</span>}</For></div></Show>
      <Show when={props.job.reviewers.length}>
        <div class="row"><For each={props.job.reviewers}>{(r) => <ReviewerChip name={r.name} model={r.model} state={liveVerdict(props.job, r.name)} />}</For></div>
      </Show>
      <Show when={kind()}>
        <div class={`flag ${flag()}`}>{flag() === "attn" ? "▲" : kind() === "needs-info" ? "?" : "◆"} {attentionReason(props.job, kind()!)}</div>
      </Show>
      <Show when={progress() != null && isActive(props.job.stage)}>
        <div class="progress" title={`Pipeline position: ${props.job.stage}`} aria-hidden="true"><i style={{ width: `${progress()}%` }} /></div>
      </Show>
      <div class="foot">
        <Pips used={props.job.round} max={props.job.max_rounds} />
        <span>{props.job.round ? `R${props.job.round}/${props.job.max_rounds}` : props.job.stage === "needs-info" ? "not started" : props.job.stage}</span>
        <span class="spacer" />
        <span title={`${duration(live.now() - ts(props.job.stage_entered_at))} in ${props.job.stage}`}>⏱ {duration(live.now() - ts(props.job.created_at))}</span>
        <span style={{ color: "var(--text)", "font-weight": "600" }}>{usd(props.job.cost?.usd)}</span>
      </div>
    </a>
  );
}

function JobTable(props: { jobs: ApiJob[]; factory: string }) {
  const live = useLive();
  return (
    <div class="ftable">
      <table>
        <caption class="sr-only">Open jobs</caption>
        <thead><tr><th class="label" scope="col">Job</th><th class="label" scope="col">Title</th><th class="label" scope="col">Stage</th><th class="label" scope="col">Risk</th><th class="label" scope="col">Reviewers</th><th class="label" scope="col">Round</th><th class="label r" scope="col">Elapsed</th><th class="label r" scope="col">Cost</th></tr></thead>
        <tbody>
          <For each={props.jobs} keyed={(j) => j.id} fallback={<tr><td colspan={8} class="faint">No open jobs.</td></tr>}>
            {(j) => (
              <tr>
                <td class="mono"><a href={jobHref(props.factory, j().id)}>{j().id}</a></td>
                <td>{j().title}<Show when={attentionKind(j())}><div class="faint" style={{ "font-size": "12.5px" }}>{attentionReason(j(), attentionKind(j())!)}</div></Show></td>
                <td><StageBadge stage={j().stage} /></td>
                <td><RiskMeter risk={j().risk} /></td>
                <td><div class="row" style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}><For each={j().reviewers}>{(r) => <ReviewerChip name={r.name} model={r.model} state={liveVerdict(j(), r.name)} />}</For></div></td>
                <td class="num">{j().round ? `R${j().round}/${j().max_rounds}` : "—"}</td>
                <td class="r num">{duration(live.now() - ts(j().created_at))}</td>
                <td class="r num">{usd(j().cost?.usd)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

