import { api } from "@/lib/api";

type WaitOptions<T = unknown> = {
  timeoutMs?: number;
  intervalMs?: number;
  onUpdate?: (payload: T) => void;
};

export async function waitForJobCompletion(queue: string, jobId: string, options: WaitOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await api.getJobStatus(queue, jobId);
    options.onUpdate?.(status);
    if (!status) throw new Error("Job não encontrado");
    if (status.state === "completed") return status;
    if (status.state === "failed") {
      throw new Error(status?.failedReason || "Job falhou");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Tempo limite excedido aguardando job");
}
