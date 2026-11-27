// Full stage file in a native modal dialog. Markdown is sanitized before render:
// stage files can quote issue text that anyone may have written (DESIGN.md §8.6).
import { Show, createEffect, createSignal, onSettled } from "solid-js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api } from "../data/api.ts";
import type { ApiFileContent } from "../shared/contract.ts";
import { CopyButton } from "./ui.tsx";

export function FileDialog(props: { factory: string; jobId: string; jobPath: string; file: string | null; onClose: () => void }) {
  let dialog!: HTMLDialogElement;
  let opener: Element | null = null;
  const [content, setContent] = createSignal<ApiFileContent | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => props.file, (file) => {
    if (!file) { if (dialog?.open) dialog.close(); return; }
    opener = document.activeElement;
    setContent(null);
    setError(null);
    if (!dialog.open) dialog.showModal();
    const ctl = new AbortController();
    api.file(props.factory, props.jobId, file, ctl.signal).then(setContent, (e: Error) => { if (e.name !== "AbortError") setError(e.message); });
    return () => ctl.abort();
  });

  onSettled(() => {
    const onClose = () => { props.onClose(); (opener as HTMLElement | null)?.focus?.(); };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  });

  const html = () => {
    const c = content();
    if (!c || c.kind !== "md") return "";
    return DOMPurify.sanitize(marked.parse(c.text, { async: false }) as string);
  };

  return (
    <dialog ref={dialog} class="file-dialog" aria-labelledby="dlg-title">
      <div class="dlg-head">
        <span class="fn" id="dlg-title">{props.file}</span>
        <span class="faint">factory/jobs/{props.jobId}/</span>
        <span class="spacer" />
        <CopyButton class="go ghost" text={`${props.jobPath}/factory/jobs/${props.jobId}/${props.file ?? ""}`} label="Copy path" />
        <button type="button" class="go ghost" onClick={() => dialog.close()} aria-label="Close file">Close ✕</button>
      </div>
      <div class="dlg-body">
        <Show when={!error()} fallback={<p class="err-text">{error()}</p>}>
          <Show when={content()} fallback={<div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}><span class="skel" style={{ width: "70%" }} /><span class="skel" style={{ width: "55%" }} /><span class="skel" style={{ width: "62%" }} /></div>}>
            <Show when={content()!.truncated}><p class="faint">Showing the {content()!.kind === "log" ? "last" : "first"} 1 MB of this file.</p></Show>
            <Show when={content()!.kind === "md"} fallback={<pre class="log full">{content()!.text}</pre>}>
              <div class="md" innerHTML={html()} />
            </Show>
          </Show>
        </Show>
      </div>
    </dialog>
  );
}
