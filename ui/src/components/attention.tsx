// "Your move" decision cards and the "Watch" list (DESIGN.md §3.2).
import { For, Show } from "solid-js";
import type { AttentionItem } from "../shared/derive.ts";
import { usd } from "../shared/derive.ts";
import { Ago, CopyButton, KindBadge } from "./ui.tsx";

const jobHref = (it: AttentionItem) =>
  it.job ? `/f/${encodeURIComponent(it.factory)}/j/${encodeURIComponent(it.job.id)}` : `/f/${encodeURIComponent(it.factory)}`;

function action(it: AttentionItem): { label: string; cmd: string } {
  const j = it.job;
  if (!j) return { label: "Open factory", cmd: "~/.claude/factory/registry.json" };
  if (it.kind === "escalated" && j.pr) return { label: `Review PR #${j.pr.number}`, cmd: `/factory feedback ${j.id} "…"` };
  if (it.kind === "escalated" || it.kind === "max-rounds") return { label: "Decide", cmd: `/factory feedback ${j.id} "…"` };
  return { label: "Open job", cmd: "" };
}

export function DecisionCards(props: { items: AttentionItem[]; showFactory?: boolean }) {
  return (
    <div class="decisions">
      <For each={props.items} keyed={(it) => `${it.factory}/${it.job?.id ?? ""}/${it.kind}`}>
        {(it, i) => (
          <article class={`decision d${Math.min(5, i() + 1)}`} aria-label={`${it().reason}: ${it().job?.title ?? it().factory}`}>
            <div class="in">
              <div class="who">
                <KindBadge kind={it().kind} extra={it().kind === "max-rounds" && it().job ? `${it().job!.round}/${it().job!.max_rounds}` : undefined} />
                <Show when={props.showFactory !== false}><span>{it().factory}</span></Show>
                <Show when={it().job}><span class="mono faint">{it().job!.id}</span></Show>
              </div>
              <div class="t">{it().job?.title ?? it().reason}</div>
              <Show when={it().question}><div class="q">{it().question}</div></Show>
              <div class="foot">
                <span class="num"><Show when={it().job} fallback={<>registry: {it().factory}</>}><Ago t={it().since} /> waiting{it().job?.cost ? ` · ${usd(it().job!.cost!.usd)}` : ""}</Show></span>
                <span class="spacer" />
                <a class="go" href={jobHref(it())}>{action(it()).label} →</a>
              </div>
              <Show when={action(it()).cmd}><CopyButton text={action(it()).cmd} /></Show>
            </div>
          </article>
        )}
      </For>
    </div>
  );
}

export function WatchList(props: { items: AttentionItem[]; showFactory?: boolean }) {
  const next = (it: AttentionItem) => {
    const j = it.job!;
    if (it.kind === "gate") return `Watch round ${j.round}/${j.max_rounds}`;
    return j.issue.source === "github" ? `Author replies on #${j.issue.ref}` : `Answer in ${j.issue.file?.split("/").pop() ?? "the backlog file"}`;
  };
  return (
    <div class="watch">
      <For each={props.items} keyed={(it) => `${it.factory}/${it.job?.id}/${it.kind}`}>
        {(it, i) => (
          <a class={`watch-row d${Math.min(5, i() + 1)}`} href={jobHref(it())}>
            <div><KindBadge kind={it().kind} /></div>
            <div>
              <div class="t"><Show when={props.showFactory !== false}><span class="muted">{it().factory} · </span></Show><span class="mono faint">{it().job?.id}</span> {it().job?.title}</div>
              <div class="why">{it().reason}{it().question ? ` · ${it().question}` : ""}</div>
            </div>
            <div class="meta num"><Ago t={it().since} /> · {usd(it().job?.cost?.usd)}<br /><span class="next">{next(it())} →</span></div>
          </a>
        )}
      </For>
    </div>
  );
}

export function SectionTitle(props: { id: string; title: string; count?: number; tone?: "attn" | "warn"; hint?: string }) {
  return (
    <div class="sec-title">
      <h2 id={props.id}>{props.title}</h2>
      <Show when={props.count != null}><span class={`count ${props.tone ?? ""}`}>{props.count}</span></Show>
      <Show when={props.hint}><span class="hint">{props.hint}</span></Show>
    </div>
  );
}
