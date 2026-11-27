// Parsing of per-stage files (docs/state-contract.md §3, "Files in a job folder").
// Every agent- or script-written .md opens with "## Summary" and 3–5 "- " bullets;
// verdict lines are plain "Key: VALUE" lines under "## Verdict".

export interface ParsedStageFile {
  summary: string[];
  verdicts: Record<string, string>;
}

const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*]\s+(.*\S)\s*$/;
const VERDICT_LINE = /^\s*([A-Za-z][A-Za-z -]*?)\s*:\s*(.+?)\s*$/;

export function parseStageFile(text: string): ParsedStageFile {
  const summary: string[] = [];
  const verdicts: Record<string, string> = {};
  let section: "none" | "summary" | "verdict" | "other" = "none";
  for (const raw of text.split(/\r?\n/)) {
    const h = HEADING.exec(raw);
    if (h) {
      const title = h[1].toLowerCase();
      section = title === "summary" ? "summary" : title === "verdict" ? "verdict" : "other";
      continue;
    }
    if (section === "summary") {
      const b = BULLET.exec(raw);
      if (b) summary.push(b[1]);
      else if (summary.length && raw.trim() && /^\s{2,}\S/.test(raw)) summary[summary.length - 1] += " " + raw.trim();
    } else if (section === "verdict") {
      const v = VERDICT_LINE.exec(raw);
      if (v) verdicts[v[1].trim()] = v[2];
    }
  }
  return { summary, verdicts };
}

/** File names the reader is allowed to serve from a job folder. */
export const JOB_FILE_PATTERN =
  /^(?:issue|intake(?:-\d+)?|spec|build-\d+|gate-\d+|review-\d+-[a-z0-9][a-z0-9-]*|feedback-\d+|approve-\d+|merge-gate-\d+|merge|reject)\.(?:md|log)$/;

export const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,120}$/;

/** Sort key so files list in pipeline order: issue, intake, spec, then by round. */
export function fileOrder(name: string): [number, number, number, string] {
  const round = Number(/-(\d+)/.exec(name)?.[1] ?? 0);
  const kind =
    name.startsWith("issue") ? 0 :
    name.startsWith("intake") ? 1 :
    name.startsWith("spec") ? 2 :
    name.startsWith("feedback") ? 3 :
    name.startsWith("build") ? 4 :
    name.startsWith("gate") ? 5 :
    name.startsWith("review") ? 6 :
    name.startsWith("approve") ? 7 :
    name.startsWith("merge-gate") ? 8 :
    name.startsWith("merge") ? 9 : 10;
  const pre = kind <= 2 ? 0 : 1;
  return [pre, pre ? round : 0, kind, name];
}

export function compareFiles(a: string, b: string): number {
  const x = fileOrder(a), y = fileOrder(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  return x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0;
}
