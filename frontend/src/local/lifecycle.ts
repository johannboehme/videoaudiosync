/**
 * Cross-cutting lifecycle helpers for the local-jobs runtime:
 *
 *   1. `markInterruptedJobsOnLoad` — runs once at module init. Any job left
 *      in `syncing`/`rendering` from a previous page session can only be
 *      interrupted (the work was driven by a now-dead tab); we surface
 *      that to the user instead of letting the job hang in limbo.
 *
 *   2. `installRenderUnloadGuard` / `removeRenderUnloadGuard` — manage a
 *      `beforeunload` listener that warns the user if they try to leave
 *      while a render is running.
 *
 *   3. `requestPersistentStorage` — asks the browser to mark our OPFS
 *      bucket as "persistent" so it doesn't get evicted under storage
 *      pressure. Called once on first user write.
 *
 *   4. `pruneIfQuotaTight` — best-effort OPFS quota guard: if usage
 *      exceeds the high-water mark, delete the oldest finished jobs until
 *      we're back under the low-water mark.
 */

import { jobsDb, type LocalJob } from "../storage/jobs-db";
import { opfs } from "../storage/opfs";
import { emitJobUpdate } from "./jobs-events";

const HIGH_WATER = 0.8; // start pruning above 80% used
const LOW_WATER = 0.6; // prune down to 60%

/**
 * Mark `syncing` / `rendering` jobs as failed with an "Interrupted" error.
 * Idempotent — safe to call multiple times.
 */
export async function markInterruptedJobsOnLoad(): Promise<number> {
  const all = await jobsDb.listJobs();
  let touched = 0;
  for (const j of all) {
    if (j.status === "syncing" || j.status === "rendering") {
      const updated = await jobsDb.updateJob(j.id, {
        status: "failed",
        error: `Interrupted: page was closed during ${j.status}. Restart the operation to retry.`,
        progress: { pct: 100, stage: "interrupted" },
        finishedAt: Date.now(),
      });
      // Emit so any open page (e.g. a JobPage that was already mounted
      // before this housekeeping ran) refreshes immediately instead of
      // showing a stale "rendering 30 %" forever.
      emitJobUpdate(updated);
      touched++;
    }
  }
  return touched;
}

const ACTIVE_RENDER_JOBS = new Set<string>();
let unloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

function ensureUnloadHandler(): void {
  if (unloadHandler) return;
  unloadHandler = (e: BeforeUnloadEvent) => {
    if (ACTIVE_RENDER_JOBS.size === 0) return;
    e.preventDefault();
    // Modern browsers ignore the message but show a generic warning.
    // We set returnValue for older Chromium / Safari compatibility.
    e.returnValue =
      "A render is still running — leaving will discard the result.";
    return e.returnValue;
  };
  window.addEventListener("beforeunload", unloadHandler);
}

export function installRenderUnloadGuard(jobId: string): void {
  ACTIVE_RENDER_JOBS.add(jobId);
  ensureUnloadHandler();
}

export function removeRenderUnloadGuard(jobId: string): void {
  ACTIVE_RENDER_JOBS.delete(jobId);
}

export function activeRenderJobsForTest(): ReadonlySet<string> {
  return ACTIVE_RENDER_JOBS;
}

let persistRequested = false;

export async function requestPersistentStorage(): Promise<boolean> {
  if (persistRequested) return true;
  persistRequested = true;
  try {
    if (!navigator.storage?.persist) return false;
    const already = await navigator.storage.persisted?.();
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * If the OPFS bucket is over `HIGH_WATER`, delete the oldest finished jobs
 * (status === "rendered" or "failed", excluding the `protectedJobIds` we
 * are about to use) until usage drops back to `LOW_WATER`. Returns the
 * number of jobs pruned.
 *
 * Best-effort: `navigator.storage.estimate()` returns aggregate browser
 * data, not just OPFS, so we use a conservative trigger threshold.
 */
export async function pruneIfQuotaTight(
  protectedJobIds: ReadonlyArray<string> = [],
): Promise<number> {
  const protectedSet = new Set(protectedJobIds);
  let estimate: { quota?: number; usage?: number };
  try {
    estimate = await navigator.storage.estimate();
  } catch {
    return 0;
  }
  const quota = estimate.quota ?? 0;
  const usage = estimate.usage ?? 0;
  if (quota <= 0) return 0;
  if (usage / quota < HIGH_WATER) return 0;

  // Prune candidates: finished or failed jobs, oldest first.
  const all = await jobsDb.listJobs();
  const candidates = all
    .filter(
      (j: LocalJob) =>
        !protectedSet.has(j.id) &&
        (j.status === "rendered" || j.status === "failed"),
    )
    .sort((a, b) => a.createdAt - b.createdAt);

  const targetBytes = quota * LOW_WATER;
  let pruned = 0;
  for (const job of candidates) {
    await opfs.deletePath(`jobs/${job.id}`).catch(() => undefined);
    await jobsDb.deleteJob(job.id);
    pruned++;
    try {
      const next = await navigator.storage.estimate();
      if ((next.usage ?? 0) <= targetBytes) break;
    } catch {
      break;
    }
  }
  return pruned;
}
