import "dotenv/config";
import { startQueueWorkers, stopQueueWorkers } from "./queues/workers.js";
import { closeQueues } from "./queues/index.js";

console.log("[WORKER] Starting queue workers...");
startQueueWorkers();

async function shutdown() {
  console.log("[WORKER] Shutting down workers...");
  await stopQueueWorkers().catch(() => { });
  await closeQueues().catch(() => { });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
