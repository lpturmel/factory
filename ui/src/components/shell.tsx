// App shell: top bar with breadcrumb, blocked pill, live indicator and theme toggle.
import { For, Show, createEffect, createMemo } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useLive, useTheme } from "../data/live.tsx";
import { YOUR_MOVE, attentionItems } from "../shared/derive.ts";
import { Ago } from "./ui.tsx";

export function Shell(props: { pathname: string; children?: JSX.Element }) {
  const live = useLive();
  const theme = useTheme();
  const blocked = createMemo(() => attentionItems(live.factories()).filter((i) => YOUR_MOVE.includes(i.kind)).length);

  createEffect(blocked, (n) => { document.title = n ? `(${n}) Factories` : "Factories"; });

  const crumbs = createMemo(() => {
    const parts = props.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const out: { label: string; href?: string; mono?: boolean }[] = [{ label: "All", href: "/" }];
    if (parts[0] === "f" && parts[1]) out.push({ label: parts[1], href: `/f/${encodeURIComponent(parts[1])}` });
    if (parts[2] === "j" && parts[3]) out.push({ label: parts[3], mono: true });
    out[out.length - 1].href = undefined;
    return out;
  });

  return (
    <div class={`fd shell ${theme.cls()}`}>
      <a class="skip" href="#main">Skip to content</a>
      <header class="topbar">
        <a class="brand" href="/"><span class="brand-mark" aria-hidden="true" />Factories</a>
        <nav class="crumbs" aria-label="Breadcrumb">
          <For each={crumbs()}>
            {(c, i) => (
              <>
                <Show when={i() > 0}><span class="faint" aria-hidden="true">/</span></Show>
                <Show when={c.href} fallback={<span class={`cur ${c.mono ? "mono" : ""}`} aria-current="page">{c.label}</span>}>
                  <a href={c.href}>{c.label}</a>
                </Show>
              </>
            )}
          </For>
        </nav>
        <span class="spacer" />
        <Show when={blocked() > 0}>
          <a class="blocked-pill" href="/#your-move"><span aria-hidden="true">▲</span>{blocked()} blocked on you</a>
        </Show>
        <span class="sr-only" aria-live="polite">{blocked() ? `${blocked()} blocked on you` : ""}</span>
        <span class="live" title={live.connected() ? "Live updates from the local reader" : "Polling (live connection down)"}>
          <span class={`ping ${live.error() ? "attn" : ""}`} aria-hidden="true" />
          <Show when={!live.error()} fallback={<>Read failed</>}>
            <Show when={live.lastReadAt()} fallback={<>Loading…</>}>
              {live.connected() ? "Live" : "Polling"} · updated <Ago t={live.lastReadAt()} /> ago
            </Show>
          </Show>
        </span>
        <button type="button" class="theme-btn" onClick={theme.cycle} aria-label={`Theme: ${theme.pref()}. Change theme`}>
          ◐ {theme.pref() === "system" ? "System" : theme.pref() === "light" ? "Light" : "Dark"}
        </button>
      </header>
      <Show when={live.error() && live.lastReadAt()}>
        <div class="errbar" role="alert">
          <b>Can't refresh:</b> {live.error()} Showing data from <Ago t={live.lastReadAt()} /> ago.
          <button type="button" class="linkish" onClick={live.reload}>Retry now</button>
        </div>
      </Show>
      <main id="main" class="page" tabindex="-1">{props.children}</main>
    </div>
  );
}
