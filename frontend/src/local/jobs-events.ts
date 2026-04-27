/**
 * Cross-module event bus for `LocalJob` updates. Lives in its own file
 * so both `jobs.ts` (the orchestrator) and `lifecycle.ts` (which can
 * mutate jobs without going through the orchestrator) can dispatch
 * without creating a circular import.
 */

import type { LocalJob } from "../storage/jobs-db";

export const jobEvents = new EventTarget();

type JobUpdateEvent = CustomEvent<{ jobId: string; job: LocalJob }>;

export function emitJobUpdate(job: LocalJob): void {
  jobEvents.dispatchEvent(
    new CustomEvent("update", { detail: { jobId: job.id, job } }) as JobUpdateEvent,
  );
}
