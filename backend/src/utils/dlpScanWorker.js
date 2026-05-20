import { parentPort, workerData } from "worker_threads";
import { scanRowsForDlp } from "./dlp.js";

try {
  const sheets = workerData?.sheets || {};
  const settings = workerData?.settings || {};
  const result = scanRowsForDlp(sheets, settings);
  parentPort.postMessage({ success: true, result });
} catch (err) {
  parentPort.postMessage({ success: false, error: err?.message || "dlp_worker_failed" });
}
