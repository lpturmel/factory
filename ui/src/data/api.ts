// Fetch wrappers for the local reader (server/reader.ts). Same-origin `/api/…`.
import type { ApiFactory, ApiFileContent, ApiJobDetail, ApiLogTail, ApiRegistry } from "../shared/contract.ts";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Can't reach the local reader. Is it running? Check `bun run login:status` (or start it with `bun run dev`).");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

const seg = encodeURIComponent;

export const api = {
  registry: (s?: AbortSignal) => get<ApiRegistry>("/api/registry", s),
  factory: (name: string, s?: AbortSignal) => get<ApiFactory>(`/api/factories/${seg(name)}`, s),
  job: (name: string, id: string, s?: AbortSignal) => get<ApiJobDetail>(`/api/factories/${seg(name)}/jobs/${seg(id)}`, s),
  file: (name: string, id: string, file: string, s?: AbortSignal) => get<ApiFileContent>(`/api/factories/${seg(name)}/jobs/${seg(id)}/files/${seg(file)}`, s),
  logTail: (name: string, id: string, round: number, tail = 40, s?: AbortSignal) =>
    get<ApiLogTail>(`/api/factories/${seg(name)}/jobs/${seg(id)}/log/${round}?tail=${tail}`, s),
};
