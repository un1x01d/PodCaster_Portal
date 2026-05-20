import path from "path";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DLP_WORKER_PATH = path.resolve(__dirname, "../../utils/dlpScanWorker.js");
const DLP_WORKER_TIMEOUT_MS = Math.max(
  3000,
  Number.parseInt(process.env.DLP_WORKER_TIMEOUT_MS || "120000", 10) || 120000
);

export function scanRowsForDlpInWorker(sheets, settings = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(DLP_WORKER_PATH, {
      workerData: { sheets, settings },
    });
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
    };
    const timer = setTimeout(async () => {
      if (settled) return;
      try {
        await worker.terminate();
      } catch {
        // Ignore terminate errors; timeout is the primary signal.
      }
      cleanup();
      reject(new Error("dlp_worker_timeout"));
    }, DLP_WORKER_TIMEOUT_MS);

    worker.on("message", (msg) => {
      if (settled) return;
      cleanup();
      if (msg?.success) {
        resolve(msg.result || { findings: [], scannedCells: 0, capped: false, maskedColumns: {}, maskedCells: {} });
        return;
      }
      reject(new Error(msg?.error || "dlp_worker_failed"));
    });
    worker.on("error", (err) => {
      if (settled) return;
      cleanup();
      reject(err);
    });
    worker.on("exit", (code) => {
      if (settled) return;
      cleanup();
      if (code !== 0) {
        reject(new Error("dlp_worker_failed"));
      } else {
        reject(new Error("dlp_worker_no_result"));
      }
    });
  });
}
