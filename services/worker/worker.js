import { createWorkerManifest, validateJobList, WORKER_JOBS } from "../_shared/runtime.js";
import { startBackendValidationLoop } from "./backend-validator.js";

const jobs = validateJobList(WORKER_JOBS);
const manifest = createWorkerManifest();

console.log(`Worker service started with ${manifest.jobCount} jobs`);
for (const job of jobs) {
  console.log(`- ${job}`);
}

startBackendValidationLoop();
