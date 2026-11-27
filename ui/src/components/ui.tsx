// Small presentational components (DESIGN.md §5). Classes come from styles/fd.css.
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ApiFactory, Risk, Stage } from "../shared/contract.ts";
import { ACTIVE_STAGES } from "../shared/contract.ts";
import { type AttentionKind, type RunState, ago, gateFailStreak, phaseOf, shortReviewer } from "../shared/derive.ts";
import { useLive } from "../data/live.tsx";

export type Tone = "attn" | "warn" | "run" | "ok" | "stale" | "mute";

export function Badge(props: { tone: Tone; children: JSX.Element; title?: string }) {
  return <span class={`badge b-${props.tone}`} title={props.title}>{props.children}</span>;
}

export const stageTone = (s: Stage): Tone =>
  s === "needs-human" ? "attn" : s === "needs-info" ? "warn" : s === "merged" ? "ok" : s === "rejected" ? "mute" : "run";

const STAGE_GLYPH: Partial<Record<Stage, string>> = { "needs-human": "▲", "needs-info": "?", merged: "✓", rejected: "✕" };

export function StageBadge(props: { stage: Stage }) {
  return <Badge tone={stageTone(props.stage)}><span aria-hidden="true">{STAGE_GLYPH[props.stage] ?? "●"}</span>{props.stage}</Badge>;
}

export function StageTag(props: { stage: Stage; stuck?: boolean }) {
  const cls = () => (props.stage === "needs-human" ? "attn" : props.stage === "needs-info" || props.stuck ? "warn" : ACTIVE_STAGES.includes(props.stage) ? "run" : "");
  return <span class={`stage-tag ${cls()}`}>{props.stage}</span>;
}

export const KIND_BADGE: Record<AttentionKind, { tone: Tone; glyph: string; label: string }> = {
  unreadable: { tone: "attn", glyph: "✕", label: "Unreadable" },
  "max-rounds": { tone: "attn", glyph: "▲", label: "Max rounds" },
  escalated: { tone: "attn", glyph: "▲", label: "Escalated" },
  gate: { tone: "warn", glyph: "◆", label: "Gate failing" },
  "needs-info": { tone: "warn", glyph: "?", label: "Needs info" },
};

export function KindBadge(props: { kind: AttentionKind; extra?: string }) {
  const b = () => KIND_BADGE[props.kind];
  return <Badge tone={b().tone}><span aria-hidden="true">{b().glyph}</span>{b().label}{props.extra ? ` ${props.extra}` : ""}</Badge>;
}

export const RUN_BADGE: Record<RunState, { tone: Tone; glyph: string; label: string }> = {
  running: { tone: "run", glyph: "●", label: "Running" },
  idle: { tone: "mute", glyph: "○", label: "Idle" },
  stopped: { tone: "stale", glyph: "■", label: "Stopped" },
  error: { tone: "attn", glyph: "✕", label: "Unreadable" },
};

export function RunBadge(props: { state: RunState }) {
  const b = () => RUN_BADGE[props.state];
  return (
    <Badge tone={b().tone}>
      <Show when={props.state === "running"} fallback={<span aria-hidden="true">{b().glyph}</span>}><span class="ping run" aria-hidden="true" /></Show>
      {b().label}
    </Badge>
  );
}

export function RiskMeter(props: { risk: Risk | null }) {
  return (
    <Show when={props.risk} fallback={<span class="faint" style={{ "font-size": "12px" }}>unrated</span>}>
      <span class={`risk ${props.risk}`} title={`Risk ${props.risk}`}><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />{props.risk}</span>
    </Show>
  );
}

export function ReviewerChip(props: { name: string; model: string; state?: "PASS" | "CHANGES" | "running" | string | null }) {
  const cls = () => (props.state === "PASS" ? "pass" : props.state === "CHANGES" ? "changes" : props.state === "running" ? "running" : "");
  return (
    <span class={`rev ${cls()}`} title={`${props.name} on ${props.model}${props.state ? `: ${props.state}` : ""}`}>
      <Show when={cls()}><span class="dot" aria-hidden="true" /></Show>
      {shortReviewer(props.name)} <span class="model">{props.model}</span>
    </span>
  );
}

export function Pips(props: { used: number; max: number }) {
  return (
    <span class="pips" aria-hidden="true">
      <For each={Array.from({ length: Math.max(props.max, props.used) }, (_, i) => i)}>
        {(i) => <i class={i < props.used ? (props.used >= props.max && i === props.used - 1 ? "u max" : "u") : ""} />}
      </For>
    </span>
  );
}

export function Sparkline(props: { days: number[] }) {
  const max = () => Math.max(1, ...props.days);
  return (
    <span class="spark" aria-hidden="true">
      <For each={props.days}>{(v) => <i class={v ? "" : "z"} style={{ height: `${Math.max(2, Math.round((v / max()) * 28))}px` }} />}</For>
    </span>
  );
}

/** 4-segment strip: you · queue · build · review (DESIGN.md §3.2). */
export function PipelineStrip(props: { factory: ApiFactory }) {
  const seg = () => {
    const jobs = props.factory.jobs;
    const c = { you: 0, queue: 0, info: 0, building: 0, stuck: 0, review: 0 };
    for (const j of jobs) {
      const p = phaseOf(j.stage);
      if (p === "you") c.you++;
      else if (p === "queue") { c.queue++; if (j.stage === "needs-info") c.info++; }
      else if (p === "building") { c.building++; if (gateFailStreak(j) >= 2) c.stuck++; }
      else if (p === "review") c.review++;
    }
    return c;
  };
  const label = () => { const c = seg(); return `${c.you} need you, ${c.queue} in queue, ${c.building} building, ${c.review} in review`; };
  return (
    <div>
      <div class="pstrip" role="img" aria-label={label()}>
        <span class={`pseg ${seg().you ? "on-attn" : ""}`} />
        <span class={`pseg ${seg().info ? "on-warn" : seg().queue ? "on-run" : ""}`} />
        <span class={`pseg ${seg().stuck ? "on-warn" : seg().building ? "on-run" : ""}`} />
        <span class={`pseg ${seg().review ? "on-run" : ""}`} />
      </div>
      <div class="pstrip-legend" aria-hidden="true"><span>you {seg().you || ""}</span><span>queue {seg().queue || ""}</span><span>build {seg().building || ""}</span><span>review {seg().review || ""}</span></div>
    </div>
  );
}

/** Relative time that ticks with the live clock. */
export function Ago(props: { t: number; suffix?: string }) {
  const live = useLive();
  return <>{ago(props.t, live.now())}{props.suffix ?? ""}</>;
}

export function CopyButton(props: { text: string; label?: string; class?: string }) {
  const [done, setDone] = createSignal(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(props.text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return <button type="button" class={props.class ?? "cmd copy"} onClick={copy} title="Copy to clipboard">{done() ? "Copied ✓" : props.label ?? props.text}</button>;
}

export function Kpi(props: { tone?: "attn" | "warn" | "run" | "ok"; label: string; value: JSX.Element; sub: JSX.Element; delay?: number }) {
  return (
    <div class={`kpi ${props.tone ?? ""} ${props.delay ? `d${props.delay}` : ""}`}>
      <div class="label">{props.label}</div>
      <div class="v">{props.value}</div>
      <div class="d">{props.sub}</div>
    </div>
  );
}
