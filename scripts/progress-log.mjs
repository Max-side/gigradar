import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, "..", "fetch-progress.log");

// Synchronous, unbuffered file writes so progress is visible immediately even
// when stdout is fully-buffered (observed: Node buffers console.log entirely
// until process exit when stdout is a redirected-to-file pipe, which made a
// backgrounded run look hung for minutes with zero visible output).
export function resetProgressLog() {
  writeFileSync(LOG_PATH, `=== run started ${new Date().toISOString()} ===\n`);
}

export function logProgress(message) {
  appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
}
