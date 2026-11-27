// Loading, empty, error and not-found states (DESIGN.md §3.5).
import { For } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useLive } from "../data/live.tsx";

export function LoadingOverview() {
  return (
    <section class="panel loading" aria-busy="true" aria-label="Loading factories">
      <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
        <span class="badge b-run"><span class="ping run" aria-hidden="true" />Loading</span>
        <span class="muted">Reading the registry…</span>
      </div>
      <div class="kpis" style={{ "margin-top": "16px" }}>
        <For each={[50, 60, 45, 55, 40]}>{(w) => <div class="kpi"><span class="skel" style={{ width: `${w}%` }} /><span class="skel" style={{ width: "30%", height: "30px", "margin-top": "10px" }} /></div>}</For>
      </div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px", "margin-top": "18px" }}>
        <For each={[92, 78, 85, 64]}>{(w) => <span class="skel" style={{ width: `${w}%` }} />}</For>
      </div>
    </section>
  );
}

function Wheel() {
  return (
    <div class="empty-ill" aria-hidden="true">
      <span>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style={{ color: "var(--run)" }}>
          <path d="M3 21h18" /><path d="M5 21V9l5 3V9l5 3V5h4v16" />
        </svg>
      </span>
    </div>
  );
}

export function EmptyState(props: { badge: string; title: string; children: JSX.Element }) {
  return (
    <section class="panel empty-state">
      <Wheel />
      <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
        <span class="badge b-mute" style={{ "align-self": "flex-start" }}>{props.badge}</span>
        <h2 style={{ "font-size": "24px" }}>{props.title}</h2>
        {props.children}
      </div>
    </section>
  );
}

export function EmptyRegistry() {
  const live = useLive();
  return (
    <EmptyState badge="Empty" title="No factories yet">
      <p class="muted" style={{ margin: 0, "max-width": "460px" }}>The registry is empty. Open a project in Claude Code and run the onboarding skill (<code class="mono">/factory-onboard</code>). Its factory shows up here within a few seconds.</p>
      <span class="cmd" style={{ "align-self": "flex-start" }}>{live.registry()?.registryPath ?? "~/.claude/factory/registry.json"} · projects: []</span>
    </EmptyState>
  );
}

export function RegistryError() {
  const live = useLive();
  const missing = () => /not found/i.test(live.error() ?? "");
  return (
    <section class="banner attn" role="alert" style={{ "flex-direction": "column" }}>
      <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
        <span class="siren" aria-hidden="true">✕</span>
        <div><span class="badge b-attn">{missing() ? "No registry" : "Read error"}</span><h2 style={{ "margin-top": "6px" }}>{missing() ? "No registry yet" : "Can't read the registry"}</h2></div>
      </div>
      <p style={{ margin: 0, "font-size": "15px" }}>{missing() ? "~/.claude/factory/registry.json doesn't exist. Onboard a project with /factory-onboard to create it." : live.error()}</p>
      <p class="muted" style={{ margin: 0 }}>The page recovers by itself on the next read.</p>
      <div style={{ display: "flex", gap: "10px", "align-items": "center" }}>
        <button type="button" class="go" onClick={live.reload}>Retry now</button>
      </div>
    </section>
  );
}

export function NotFound(props: { what: string }) {
  return (
    <EmptyState badge="Not found" title={`${props.what} isn't here`}>
      <p class="muted" style={{ margin: 0 }}>It may have been removed from the registry, or the job folder was cleaned up.</p>
      <a class="go ghost" href="/" style={{ "align-self": "flex-start" }}>Back to all factories</a>
    </EmptyState>
  );
}

export function Spinner(props: { label: string }) {
  return <div class="panel" aria-busy="true"><span class="badge b-run"><span class="ping run" aria-hidden="true" />{props.label}</span><div style={{ display: "flex", "flex-direction": "column", gap: "12px", "margin-top": "16px" }}><For each={[88, 70, 80]}>{(w) => <span class="skel" style={{ width: `${w}%` }} />}</For></div></div>;
}
