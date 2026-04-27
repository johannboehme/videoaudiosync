/**
 * IndexedDB-Wrapper für lokale Job-Metadaten.
 *
 * Mediadaten (Video, Audio, Render-Output) leben in OPFS (siehe ./opfs.ts).
 * Hier liegen nur strukturierte Daten: Status, Sync-Result, Edit-Spec,
 * Progress, Timing.
 */

import { openDB, type IDBPDatabase } from "idb";

export interface SyncResult {
  offsetMs: number;
  driftRatio: number;
  confidence: number;
  warning?: string;
}

export interface JobProgress {
  pct: number;
  stage: string;
  detail?: string;
  etaS?: number;
}

export type JobStatus =
  | "queued"
  | "syncing"
  | "synced"
  | "rendering"
  | "rendered"
  | "failed";

export interface LocalJob {
  id: string;
  title: string | null;
  videoFilename: string;
  audioFilename: string;

  status: JobStatus;
  progress: JobProgress;
  error?: string;

  sync?: SyncResult;

  durationS?: number;
  width?: number;
  height?: number;
  fps?: number;

  /** EditSpec (typisiert in einem späteren Modul). Bewusst unknown hier, um
   * Coupling zu vermeiden. */
  editSpec?: unknown;

  hasOutput: boolean;
  outputBytes?: number;

  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

const DB_NAME = "videoaudiosync";
const DB_VERSION = 1;
const STORE = "jobs";

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("by-createdAt", "createdAt");
        }
      },
    });
  }
  return dbPromise;
}

async function saveJob(job: LocalJob): Promise<void> {
  const d = await db();
  await d.put(STORE, job);
}

async function getJob(id: string): Promise<LocalJob | undefined> {
  const d = await db();
  return (await d.get(STORE, id)) as LocalJob | undefined;
}

async function listJobs(): Promise<LocalJob[]> {
  const d = await db();
  const all = (await d.getAll(STORE)) as LocalJob[];
  // Sortierung newest-first für die History-Page.
  all.sort((a, b) => b.createdAt - a.createdAt);
  return all;
}

async function updateJob(id: string, patch: Partial<LocalJob>): Promise<LocalJob> {
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  const existing = (await tx.store.get(id)) as LocalJob | undefined;
  if (!existing) {
    await tx.done;
    throw new Error(`Job not found: ${id}`);
  }
  const merged: LocalJob = { ...existing, ...patch, id: existing.id };
  await tx.store.put(merged);
  await tx.done;
  return merged;
}

async function deleteJob(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
}

async function wipeAll(): Promise<void> {
  const d = await db();
  await d.clear(STORE);
}

export const jobsDb = {
  saveJob,
  getJob,
  listJobs,
  updateJob,
  deleteJob,
  wipeAll,
};

export type JobsDb = typeof jobsDb;
