import { api, getToken } from "@/lib/api";

type WaitOptions<T = unknown> = {
  timeoutMs?: number;
  intervalMs?: number;
  onUpdate?: (payload: T) => void;
};

function resolveWsBase() {
  const apiBase = import.meta.env.VITE_API_URL || "";
  if (apiBase && apiBase.startsWith("http")) {
    const url = new URL(apiBase);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}`;
  }
  if (typeof window !== "undefined") {
    return window.location.origin.replace(/^http/, "ws");
  }
  return "ws://localhost:4000";
}

export function subscribeJobEvents(queues: string[], jobId: string, onEvent: (evt: any) => void, onError?: (err: any) => void) {
  const qs = new URLSearchParams();
  if (queues.length > 0) qs.set("queues", queues.join(","));
  if (jobId) qs.set("jobId", jobId);
  const token = getToken();
  if (token) qs.set("token", token);
  const wsUrl = `${resolveWsBase()}/ws/jobs?${qs.toString()}`;
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (msg) => {
    try {
      const evt = JSON.parse(msg.data as string);
      onEvent(evt);
    } catch {
      // ignore malformed
    }
  };
  ws.onerror = (err) => {
    onError?.(err);
  };
  ws.onclose = () => {
    // noop
  };

  return () => {
    try { ws.close(); } catch { /* ignore */ }
  };
}

export async function waitForJobCompletion(queue: string, jobId: string, options: WaitOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;

  let resolved = false;
  let wsError = false;
  let wsCleanup: (() => void) | null = null;

  const wsPromise = new Promise<any>((resolve, reject) => {
    try {
      wsCleanup = subscribeJobEvents([queue], jobId, (evt) => {
        const state = evt?.event || evt?.state;
        if (state === "progress" && typeof evt.progress === "number") {
          options.onUpdate?.({ ...evt, state: "progress" });
        }
        if (state === "completed") {
          resolved = true;
          wsCleanup?.();
          resolve({
            id: jobId,
            queue,
            state: "completed",
            progress: 100,
            returnValue: evt?.result ?? evt?.returnValue ?? null,
            finishedOn: evt?.ts || Date.now(),
          });
        }
        if (state === "failed") {
          resolved = true;
          wsCleanup?.();
          reject(new Error(evt?.failedReason || "Job falhou"));
        }
      }, () => {
        wsError = true;
        wsCleanup?.();
        reject(new Error("ws-error"));
      });
    } catch (err) {
      wsError = true;
      reject(err);
    }
  });

  const pollPromise = (async () => {
    while (!resolved && Date.now() < deadline) {
      const status = await api.getJobStatus(queue, jobId);
      options.onUpdate?.(status);
      if (!status) throw new Error("Job não encontrado");
      if (status.state === "completed") {
        resolved = true;
        return status;
      }
      if (status.state === "failed") {
        throw new Error(status?.failedReason || "Job falhou");
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error("Tempo limite excedido aguardando job");
  })();

  try {
    if (!wsError) {
      // Race: prefer WS, fallback to polling if WS errors or times out.
      const result = await Promise.race([wsPromise, pollPromise]);
      return result;
    }
    return await pollPromise;
  } finally {
    wsCleanup?.();
  }
}
