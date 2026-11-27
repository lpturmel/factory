// One job: decision banner, pipeline flow, folded rounds timeline, verdicts, cost (DESIGN.md §3.4).
import { For, Show, createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { RouteSectionProps } from "@solidjs/router";
import { useLive } from "../data/live.tsx";
import { api, ApiError } from "../data/api.ts";
import type { ApiJobDetail, ApiJobFile, JobJson, Stage } from "../shared/contract.ts";
import { FLOW_STAGES } from "../shared/contract.ts";
import {
  type Cell, type StageSpan, YOUR_MOVE, attentionFile, attentionKind, attentionReason, duration, reviewMatrix, roundSummaries,
  shortReviewer, stageSpans, ts, usd,
} from "../shared/derive.ts";
import { Badge, CopyButton, KindBadge, ReviewerChip, RiskMeter, StageTag } from "../components/ui.tsx";
import { FileDialog } from "../components/FileDialog.tsx";
import { NotFound, Spinner } from "../components/states.tsx";

const TERMINAL: Stage[] = ["needs-human", "merged", "rejected"];

export default function Job(props: RouteSectionProps) {
  const live = useLive();
  const key = () => `${props.params.name ?? ""}\u0000${props.params.id ?? ""}`;
  const [detail, setDetail] = createSignal<ApiJobDetail | null>(null);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [openFile, setOpenFile] = createSignal<string | null>(null);

  createEffect(key, (k) => {
    const [name, id] = k.split("\u0000");
    setDetail(null);
    setError(null);
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      api.job(name, id).then(
        (d) => { if (mine === seq) { setDetail(d); setError(null); } },
        (e: ApiError) => { if (mine === seq) setError(e); },
      );
    };
    load();
    const unsub = live.subscribe((ev) => { if (ev.type === "factory" && ev.name === name && (!ev.jobId || ev.jobId === id)) load(); });
    const poll = setInterval(load, 10_000);
    return () => { unsub(); clearInterval(poll); seq++; };
  });

  return (
    <Show when={detail()} fallback={<Show when={error()} fallback={<Spinner label="Loading job" />}>{error()!.status === 404 ? <NotFound what={`Job “${props.params.id}”`} /> : <div class="banner attn" role="alert"><div><div class="big">Can't load this job</div><p>{error()!.message}</p></div></div>}</Show>}>
      <JobView detail={detail()!} onOpen={setOpenFile} />
      <FileDialog factory={detail()!.factory} jobId={detail()!.job.id} jobPath={detail()!.path} file={openFile()} onClose={() => setOpenFile(null)} />
    </Show>
  );
}

function JobView(props: { detail: ApiJobDetail; onOpen: (name: string) => void }) {
  const live = useLive();
  const j = () => props.detail.job;
  const files = createMemo(() => new Map(props.detail.files.map((f) => [f.name, f])));
  const kind = createMemo(() => attentionKind(j()));
  const spans = createMemo(() => stageSpans(j(), live.now()));
  const question = createMemo(() => {
    const k = kind();
    if (!k) return [];
    const f = attentionFile(j(), k);
    return (f && files().get(f)?.summary) || (j().note ? [j().note] : []);
  });

  const groups = createMemo(() => {
    const s = spans();
    const out: { round: number; spans: StageSpan[] }[] = [{ round: 0, spans: [] }];
    for (const sp of s) {
      if (TERMINAL.includes(sp.stage)) continue;
      let g = out.find((x) => x.round === sp.round);
      if (!g) { g = { round: sp.round, spans: [] }; out.push(g); }
      g.spans.push(sp);
    }
    return out.filter((g) => g.spans.length).sort((a, b) => a.round - b.round);
  });
  const outcome = createMemo(() => { const last = spans().at(-1); return last && TERMINAL.includes(last.stage) ? last : null; });
  const rounds = createMemo(() => new Map(roundSummaries(j(), live.now()).map((r) => [r.round, r])));
  const latestRound = () => groups().at(-1)?.round ?? 0;
  // Rounds the user opened or closed by hand; the rest follow "newest open".
  const [toggled, setToggled] = createSignal<Record<number, boolean>>({});
  const isOpen = (round: number) => toggled()[round] ?? round === latestRound();
  const onToggle = (round: number, e: Event) => {
    const open = (e.currentTarget as HTMLDetailsElement).open;
    if (open !== isOpen(round)) setToggled((t) => ({ ...t, [round]: open }));
  };

  return (
    <>
      <div class="head">
        <div style={{ flex: "1 1 600px", "min-width": "0" }}>
          <div style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: "10px" }}>
            <span class="mono faint">{j().id}</span><StageTag stage={j().stage} /><RiskMeter risk={j().risk} />
            <For each={j().surfaces}>{(s) => <span class="chip">{s}</span>}</For>
          </div>
          <h1 style={{ "margin-top": "8px" }}>{j().title}</h1>
          <div class="sub">
            <Show when={j().round}><span>Round <b class="hi">{j().round} of {j().max_rounds}</b></span></Show>
            <span>⏱ <b class="hi">{duration(live.now() - ts(j().created_at))}</b> · {duration(live.now() - ts(j().stage_entered_at))} in {j().stage}</span>
            <span>Cost <b class="hi">{usd(j().cost?.usd)}</b></span>
            <span class="mono faint">factory/jobs/{j().id}/</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", "flex-wrap": "wrap" }}>
          <Show when={j().issue.url} fallback={<Show when={j().issue.file}><CopyButton class="go ghost" text={`${props.detail.path}/${j().issue.file}`} label={`Backlog file: ${j().issue.file!.split("/").pop()} (copy path)`} /></Show>}>
            <a class="go ghost" href={j().issue.url!} target="_blank" rel="noreferrer">Issue #{j().issue.ref} ↗</a>
          </Show>
          <Show when={j().pr} fallback={<Show when={j().branch}><span class="cmd">{j().branch}</span></Show>}>
            <a class="go ghost" href={j().pr!.url} target="_blank" rel="noreferrer">PR #{j().pr!.number}{j().pr!.draft ? " (draft)" : ""} ↗</a>
          </Show>
        </div>
      </div>

      <Show when={kind()}>
        <Show when={YOUR_MOVE.includes(kind()!)} fallback={
          <section class="banner warn" role="status">
            <KindBadge kind={kind()!} />
            <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
              <div class="big">{attentionReason(j(), kind()!)}</div>
              <For each={question()}>{(q) => <div>{q}</div>}</For>
            </div>
          </section>
        }>
          <section class="banner attn" aria-labelledby="decH">
            <div class="siren" aria-hidden="true">!</div>
            <div style={{ display: "flex", "flex-direction": "column", gap: "10px", "min-width": "0" }}>
              <div class="big" id="decH">{attentionReason(j(), kind()!)}. Your call.</div>
              <For each={question()}>{(q, i) => <div style={{ "font-size": i() === 0 ? "15.5px" : "14px", color: i() === 0 ? "var(--text)" : "var(--muted)" }}>{q}</div>}</For>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "10px", "align-items": "center" }}>
                <Show when={j().pr}><a class="go" href={j().pr!.url} target="_blank" rel="noreferrer">Review PR #{j().pr!.number} ↗</a><span class="muted">merge it to approve, or</span></Show>
                <CopyButton text={`/factory feedback ${j().id} "…"`} /><span class="muted">runs round {j().round + 1}</span>
                <CopyButton text={`/factory reject ${j().id} "reason"`} />
              </div>
            </div>
          </section>
        </Show>
      </Show>

      <Flow job={j()} />

      <div class="jgrid">
        <section class="jmain" aria-labelledby="tlH">
          <div class="sec-title" style={{ "margin-bottom": "0" }}><h2 id="tlH">Timeline</h2><span class="hint">Finished rounds fold to one line · newest open</span></div>
          <For each={groups()} keyed={(g) => g.round}>
            {(g) => (
              <details class="round" open={isOpen(g().round)} onToggle={(e) => onToggle(g().round, e)}>
                <summary>
                  <span class="chev" aria-hidden="true">›</span>
                  <b>{g().round === 0 ? "Setup" : `Round ${g().round}`}</b>
                  <RoundBadges job={j()} round={g().round} summary={rounds().get(g().round)} files={files()} />
                  <span class="spacer" />
                  <span class="faint num">{duration(g().spans.reduce((a, s) => a + s.ms, 0))}</span>
                </summary>
                <div class="body">
                  <For each={g().spans}>{(sp) => <Step job={j()} span={sp} files={files()} factory={props.detail.factory} onOpen={props.onOpen} />}</For>
                </div>
              </details>
            )}
          </For>
          <Show when={outcome()}>
            <div class="round outcome">
              <div class="step" style={{ padding: "14px 18px" }}>
                <span class={`ic ${outcome()!.stage === "merged" ? "ok" : outcome()!.stage === "rejected" ? "warn" : "attn"}`} aria-hidden="true">{outcome()!.stage === "merged" ? "✓" : outcome()!.stage === "rejected" ? "✕" : "▲"}</span>
                <div>
                  <div class="hd"><span class="name">{outcome()!.stage}</span><Show when={outcome()!.note}><span class="muted">{outcome()!.note}</span></Show><span class="when">{new Date(outcome()!.at).toLocaleString()}</span></div>
                  <For each={["approve-" + j().round + ".md", "merge.md", "reject.md"].map((n) => files().get(n)).filter((f): f is ApiJobFile => !!f)}>
                    {(f) => <FileCard file={f} onOpen={props.onOpen} />}
                  </For>
                </div>
              </div>
            </div>
          </Show>
        </section>

        <aside class="jside" aria-label="Job details">
          <Show when={j().reviewers.length && j().round}>
            <div class="panel"><Matrix job={j()} onOpen={props.onOpen} files={files()} /></div>
          </Show>
          <div class="panel"><Costs job={j()} /></div>
          <div class="panel">
            <div class="sec-title"><h3>Routing</h3></div>
            <Show when={j().reviewers.length} fallback={<p class="faint" style={{ margin: 0 }}>Not routed yet: intake decides risk and surfaces.</p>}>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}><For each={j().reviewers}>{(r) => <ReviewerChip name={r.name} model={r.model} />}</For></div>
              <div class="foot-note">From risk {j().risk ?? "—"}{j().surfaces.length ? ` + surfaces ${j().surfaces.join(", ")}` : ""} via config.json. Builder runs on {j().models?.builder ?? "opus"}.</div>
            </Show>
          </div>
          <div class="panel">
            <div class="sec-title"><h3>All files</h3><span class="hint">{props.detail.files.length}</span></div>
            <ul class="filelist">
              <For each={props.detail.files} keyed={(f) => f.name}>
                {(f) => <li><button type="button" class="linkish mono" onClick={() => props.onOpen(f().name)}>{f().name}</button><span class="faint">{fmtSize(f().size)}</span></li>}
              </For>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function RoundBadges(props: { job: JobJson; round: number; summary?: { gate: "PASS" | "FAIL" | null; pass: number; changes: number }; files: Map<string, ApiJobFile> }) {
  const takeaway = () => {
    const r = props.round;
    if (r === 0) return props.job.verdicts?.intake ? `intake ${props.job.verdicts.intake}` : "";
    if (props.summary?.gate === "FAIL") return props.files.get(`gate-${r}.md`)?.summary[0] ?? "";
    const changes = Object.entries(props.job.verdicts?.review?.[String(r)] ?? {}).find(([, v]) => v === "CHANGES");
    return changes ? `${shortReviewer(changes[0])}: ${props.files.get(`review-${r}-${changes[0]}.md`)?.summary[0] ?? "asked for changes"}` : "";
  };
  return (
    <>
      <Show when={props.round > 0 && props.summary?.gate}>
        <Badge tone={props.summary!.gate === "PASS" ? "ok" : "attn"}>gate {props.summary!.gate === "PASS" ? "✓" : "✕ FAIL"}</Badge>
      </Show>
      <Show when={props.round > 0 && (props.summary?.pass || props.summary?.changes)}>
        <Badge tone={props.summary!.changes ? "warn" : "ok"}>review: {props.summary!.pass} pass{props.summary!.changes ? ` · ${props.summary!.changes} changes` : ""}</Badge>
      </Show>
      <Show when={takeaway()}><span class="muted takeaway">{takeaway()}</span></Show>
    </>
  );
}

function filesForSpan(job: JobJson, sp: StageSpan, files: Map<string, ApiJobFile>): ApiJobFile[] {
  const r = sp.round;
  const names: string[] =
    sp.stage === "intake" ? ["intake.md", ...[...files.keys()].filter((n) => /^intake-\d+\.md$/.test(n))] :
    sp.stage === "spec" ? ["spec.md"] :
    sp.stage === "build" ? [`build-${r}.md`, ...[...files.keys()].filter((n) => /^feedback-\d+\.md$/.test(n) && r === job.round)] :
    sp.stage === "gate" ? [`gate-${r}.md`] :
    sp.stage === "approve" ? [`approve-${r}.md`] :
    sp.stage === "merging" ? [`merge-gate-${r}.md`, "merge.md"] : [];
  if (sp.stage === "review") {
    const rev = job.verdicts?.review?.[String(r)] ?? {};
    return [...files.values()].filter((f) => f.name.startsWith(`review-${r}-`) && f.name.endsWith(".md"))
      .sort((a, b) => (rev[reviewerOf(b.name, r)] === "CHANGES" ? 1 : 0) - (rev[reviewerOf(a.name, r)] === "CHANGES" ? 1 : 0));
  }
  return names.map((n) => files.get(n)).filter((f): f is ApiJobFile => !!f);
}

const reviewerOf = (file: string, round: number) => file.slice(`review-${round}-`.length, -".md".length);

function Step(props: { job: JobJson; span: StageSpan; files: Map<string, ApiJobFile>; factory: string; onOpen: (n: string) => void }) {
  const r = () => props.span.round;
  const gate = () => (props.span.stage === "gate" ? props.job.verdicts?.gate?.[String(r())] : undefined);
  const reviews = () => (props.span.stage === "review" ? props.job.verdicts?.review?.[String(r())] ?? {} : {});
  const running = () => props.span.current && !TERMINAL.includes(props.span.stage);
  const tone = () => {
    if (running()) return "run";
    if (gate() === "FAIL") return "attn";
    if (Object.values(reviews()).includes("CHANGES")) return "warn";
    return "ok";
  };
  const agent = () => {
    const m = props.job.models ?? {};
    switch (props.span.stage) {
      case "intake": case "needs-info": return `intake · ${m.intake ?? "fable"}`;
      case "spec": return `spec-writer · ${m["spec-writer"] ?? "opus"}`;
      case "build": return `builder · ${m.builder ?? "opus"}`;
      case "approve": return `approver · ${m.approver ?? "opus"}`;
      case "review": return `${props.job.reviewers.length} reviewers`;
      default: return "script";
    }
  };
  const fs = () => filesForSpan(props.job, props.span, props.files);
  return (
    <div class="step">
      <span class={`ic ${tone()}`} aria-hidden="true">{tone() === "ok" ? "✓" : tone() === "attn" ? "✕" : tone() === "warn" ? "!" : "●"}</span>
      <div style={{ "min-width": "0" }}>
        <div class="hd">
          <span class="name">{props.span.stage}</span><span class="model">{agent()}</span>
          <Show when={gate()}><Badge tone={gate() === "PASS" ? "ok" : "attn"}>{gate()}</Badge></Show>
          <For each={props.job.reviewers.filter(() => props.span.stage === "review")}>
            {(rv) => <ReviewerChip name={rv.name} model={rv.model} state={reviews()[rv.name] ?? (running() ? "running" : null)} />}
          </For>
          <Show when={running()}><Badge tone="run"><span class="ping run" aria-hidden="true" />running</Badge></Show>
          <span class="when">{running() ? "for " : ""}{duration(props.span.ms)}</span>
        </div>
        <For each={fs()} keyed={(f) => f.name}>
          {(f, i) => <FileCard file={f()} onOpen={props.onOpen} compact={props.span.stage === "review" && i() > 0 && reviews()[reviewerOf(f().name, r())] !== "CHANGES"} />}
        </For>
        <Show when={gate() === "FAIL" || (props.span.stage === "gate" && !gate() && props.files.has(`gate-${r()}.log`))}>
          <LogTail factory={props.factory} jobId={props.job.id} round={r()} onOpen={props.onOpen} />
        </Show>
        <Show when={running() && !fs().length}>
          <div class="file"><div style={{ padding: "12px 14px", display: "flex", "flex-direction": "column", gap: "8px" }}>
            <span class="skel" style={{ width: "60%" }} /><span class="skel" style={{ width: "40%" }} />
            <span class="faint" style={{ "font-size": "12.5px" }}>The summary appears when the {props.span.stage} file lands.</span>
          </div></div>
        </Show>
        <Show when={props.span.note && !fs().length && !running()}><div class="muted" style={{ "margin-top": "6px" }}>{props.span.note}</div></Show>
      </div>
    </div>
  );
}

function FileCard(props: { file: ApiJobFile; onOpen: (n: string) => void; compact?: boolean }) {
  const verdict = () => props.file.verdicts.Verdict ?? props.file.verdicts.Result ?? props.file.verdicts.Decision;
  return (
    <div class={`file ${props.compact ? "compact" : ""}`}>
      <div class="fh">
        <span class="fn">{props.file.name}</span>
        <Show when={verdict()}><Badge tone={/PASS|APPROVE|ACCEPT/.test(verdict()!) ? "ok" : /FAIL|REJECT/.test(verdict()!) ? "attn" : "warn"}>{verdict()}</Badge></Show>
        <Show when={!props.compact && props.file.summary.length}><span class="faint">## Summary</span></Show>
        <button type="button" class="open linkish" onClick={() => props.onOpen(props.file.name)}>Open full file</button>
      </div>
      <Show when={!props.compact && props.file.summary.length}>
        <ul><For each={props.file.summary}>{(s) => <li>{s}</li>}</For></ul>
      </Show>
    </div>
  );
}

function LogTail(props: { factory: string; jobId: string; round: number; onOpen: (n: string) => void }) {
  const [lines, setLines] = createSignal<string[] | null>(null);
  onSettled(() => {
    const ctl = new AbortController();
    api.logTail(props.factory, props.jobId, props.round, 14, ctl.signal).then((t) => setLines(t.lines), () => setLines([]));
    return () => ctl.abort();
  });
  const bad = (l: string) => /FAIL|error|✕|assertion failed|panicked|Expected|Received/i.test(l);
  return (
    <Show when={lines()?.length}>
      <div class="file">
        <div class="fh"><span class="fn">gate-{props.round}.log</span><span class="faint">tail</span><button type="button" class="open linkish" onClick={() => props.onOpen(`gate-${props.round}.log`)}>Open full log</button></div>
        <pre class="log" aria-label={`Last lines of gate-${props.round}.log`}><For each={lines()!}>{(l) => (bad(l) ? <b>{l + "\n"}</b> : l + "\n")}</For></pre>
      </div>
    </Show>
  );
}

function Flow(props: { job: JobJson }) {
  let box!: HTMLElement;
  const cur = createMemo(() => {
    const s = props.job.stage;
    if (s === "needs-human") return { idx: FLOW_STAGES.indexOf("approve"), label: "needs you", tone: "attn" };
    if (s === "needs-info") return { idx: 0, label: "needs info", tone: "warn" };
    if (s === "rejected") {
      const prev = [...props.job.history].reverse().find((h) => FLOW_STAGES.includes(h.stage));
      return { idx: prev ? FLOW_STAGES.indexOf(prev.stage) : 0, label: "rejected", tone: "mute" };
    }
    return { idx: FLOW_STAGES.indexOf(s), label: s, tone: s === "merged" ? "ok" : "run" };
  });
  onSettled(() => {
    const el = box?.querySelector<HTMLElement>('[aria-current="step"]');
    if (el) box.scrollLeft = el.offsetLeft - box.offsetLeft - 40;
  });
  return (
    <nav class="flow" aria-label="Pipeline position" ref={box}>
      <For each={FLOW_STAGES as Stage[]}>
        {(s, i) => {
          const state = () => (props.job.stage === "merged" ? "done" : i() < cur().idx ? "done" : i() === cur().idx ? "cur" : "");
          return (
            <>
              <Show when={i() > 0}><span class={`edge ${i() <= cur().idx ? "done" : ""}`} aria-hidden="true" /></Show>
              <div class={`node ${state()} ${state() === "cur" ? `t-${cur().tone}` : ""}`} aria-current={state() === "cur" ? "step" : undefined}>
                <span class="c">{state() === "done" ? "✓" : state() === "cur" ? (cur().tone === "attn" ? "▲" : cur().tone === "warn" ? "?" : cur().tone === "mute" ? "✕" : "●") : i() + 1}</span>
                <span class="l">{state() === "cur" ? cur().label : s}</span>
              </div>
            </>
          );
        }}
      </For>
    </nav>
  );
}

function Matrix(props: { job: JobJson; files: Map<string, ApiJobFile>; onOpen: (n: string) => void }) {
  const m = createMemo(() => reviewMatrix(props.job));
  const label: Record<Cell, string> = { PASS: "PASS", CHANGES: "CHANGES", skip: "not run", running: "running", pending: "—" };
  const cls: Record<Cell, string> = { PASS: "pass", CHANGES: "changes", skip: "skip", running: "running", pending: "skip" };
  const model = (name: string) => props.job.reviewers.find((r) => r.name === name)?.model ?? "";
  const gateFailed = () => Object.entries(props.job.verdicts?.gate ?? {}).filter(([, v]) => v === "FAIL").map(([k]) => k);
  return (
    <>
      <div class="sec-title"><h3>Reviews by round</h3></div>
      <div class="table-scroll">
        <table class="matrix">
          <caption class="sr-only">Reviewer verdicts per round</caption>
          <thead><tr><th class="label" scope="col">Reviewer</th><For each={m().rounds}>{(_, i) => <th class="label" scope="col">R{i() + 1}</th>}</For></tr></thead>
          <tbody>
            <For each={m().reviewers}>
              {(name, ri) => (
                <tr>
                  <th scope="row" style={{ "font-weight": "600" }}>{shortReviewer(name)} <span class="model">{model(name)}</span></th>
                  <For each={m().rounds}>
                    {(round, i) => {
                      const c = () => round[ri()];
                      const file = () => `review-${i() + 1}-${name}.md`;
                      return (
                        <td>
                          <Show when={(c() === "PASS" || c() === "CHANGES") && props.files.has(file())} fallback={<span class={`v ${cls[c()]}`}>{label[c()]}</span>}>
                            <button type="button" class="verdict-btn" onClick={() => props.onOpen(file())} aria-label={`${shortReviewer(name)} round ${i() + 1}: ${c()}. Open ${file()}`}>
                              <span class={`v ${cls[c()]}`}>{label[c()]}</span>
                            </button>
                          </Show>
                        </td>
                      );
                    }}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={gateFailed().length}><div class="foot-note">Round {gateFailed().join(", ")}: gate failed, so no reviewer ran.</div></Show>
    </>
  );
}

function Costs(props: { job: JobJson }) {
  const rows = createMemo(() => {
    const by = Object.entries(props.job.cost?.by_agent ?? {}).sort((a, b) => b[1] - a[1]);
    const max = Math.max(0.0001, ...by.map(([, v]) => v));
    const lastRev = (() => {
      const rounds = Object.keys(props.job.verdicts?.review ?? {}).map(Number).sort((a, b) => b - a);
      for (const r of rounds) { const v = props.job.verdicts?.review?.[String(r)]; if (v && Object.keys(v).length) return v; }
      return {} as Record<string, string>;
    })();
    return by.map(([agent, v]) => {
      const reviewer = props.job.reviewers.find((r) => r.name === agent);
      const model = reviewer?.model ?? props.job.models?.[agent] ?? "";
      const color = agent === "intake" ? "var(--stale)" : reviewer ? (lastRev[agent] === "CHANGES" ? "var(--warn)" : "var(--ok)") : "var(--run)";
      return { agent: reviewer ? shortReviewer(agent) : agent, model, usd: v, w: Math.max(3, Math.round((v / max) * 100)), color };
    });
  });
  return (
    <>
      <div class="sec-title"><h3>Cost by agent</h3><span class="spacer" /><span class="bignum">{usd(props.job.cost?.usd)}</span></div>
      <Show when={rows().length} fallback={<p class="faint" style={{ margin: 0 }}>No cost recorded yet.</p>}>
        <div class="bars">
          <For each={rows()} keyed={(r) => r.agent}>
            {(r) => (
              <div class="bar-row">
                <span>{r().agent} <span class="model">{r().model}</span></span>
                <span class="bar" aria-hidden="true"><i style={{ width: `${r().w}%`, "--c": r().color }} /></span>
                <span class="num" style={{ "text-align": "right", "font-weight": "600" }}>{usd(r().usd)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="foot-note">API-equivalent, from subagent transcripts. On a subscription this is relative spend, not your bill.</div>
    </>
  );
}
