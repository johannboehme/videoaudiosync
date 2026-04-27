/**
 * Origin Private File System wrapper.
 *
 * Wir nutzen OPFS als Truth-Source für alle Mediadaten (roh-Video, roh-Audio,
 * Render-Outputs). OPFS hat kein 4-GB-Memory-Limit wie Blob-URLs und überlebt
 * Page-Reloads — perfekt um den Upload zum Server zu vermeiden.
 *
 * Path-Konvention: posix-style mit "/" als Separator. Beispiel:
 *   "jobs/{jobId}/video.mp4"
 *   "jobs/{jobId}/audio.wav"
 *   "jobs/{jobId}/render.mp4"
 *
 * Alle Methoden sind async, weil OPFS ohnehin nur eine async-API hat (außer
 * den synchronen Worker-Methoden, die wir hier nicht brauchen).
 */

type WritablePayload = Blob | ArrayBuffer | ArrayBufferView;

async function root(): Promise<FileSystemDirectoryHandle> {
  return await navigator.storage.getDirectory();
}

function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error(`Invalid OPFS path: "${path}"`);
  const name = parts[parts.length - 1];
  return { dirs: parts.slice(0, -1), name };
}

async function resolveDir(
  segments: string[],
  options: { create: boolean },
): Promise<FileSystemDirectoryHandle | null> {
  let dir = await root();
  for (const seg of segments) {
    try {
      dir = await dir.getDirectoryHandle(seg, { create: options.create });
    } catch (err) {
      if (!options.create && (err as DOMException).name === "NotFoundError") return null;
      throw err;
    }
  }
  return dir;
}

async function getFileHandle(
  path: string,
  options: { create: boolean },
): Promise<FileSystemFileHandle | null> {
  const { dirs, name } = splitPath(path);
  const dir = await resolveDir(dirs, { create: options.create });
  if (!dir) return null;
  try {
    return await dir.getFileHandle(name, { create: options.create });
  } catch (err) {
    if (!options.create && (err as DOMException).name === "NotFoundError") return null;
    throw err;
  }
}

async function writeFile(path: string, data: WritablePayload): Promise<void> {
  const handle = await getFileHandle(path, { create: true });
  if (!handle) throw new Error(`Failed to create file handle for "${path}"`);

  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    // The DOM type for write() rejects SharedArrayBuffer-backed views; in
    // practice the underlying API accepts any BufferSource. We cast here
    // because callers can legitimately pass typed arrays from any source.
    await writable.write(data as Blob | BufferSource);
  } finally {
    await writable.close();
  }
}

async function createWritable(path: string): Promise<FileSystemWritableFileStream> {
  const handle = await getFileHandle(path, { create: true });
  if (!handle) throw new Error(`Failed to create file handle for "${path}"`);
  return await handle.createWritable({ keepExistingData: false });
}

async function readFile(path: string): Promise<File> {
  const handle = await getFileHandle(path, { create: false });
  if (!handle) throw new Error(`File not found: "${path}"`);
  return await handle.getFile();
}

async function exists(path: string): Promise<boolean> {
  const handle = await getFileHandle(path, { create: false });
  return handle !== null;
}

async function deleteFile(path: string): Promise<void> {
  const { dirs, name } = splitPath(path);
  const dir = await resolveDir(dirs, { create: false });
  if (!dir) return;
  try {
    await dir.removeEntry(name);
  } catch (err) {
    if ((err as DOMException).name === "NotFoundError") return;
    throw err;
  }
}

async function deletePath(path: string): Promise<void> {
  // Recursive delete für Verzeichnisse (oder Files).
  const { dirs, name } = splitPath(path);
  const parent = await resolveDir(dirs, { create: false });
  if (!parent) return;
  try {
    await parent.removeEntry(name, { recursive: true });
  } catch (err) {
    if ((err as DOMException).name === "NotFoundError") return;
    throw err;
  }
}

async function list(path: string): Promise<string[]> {
  const segments = path.split("/").filter((p) => p.length > 0);
  const dir = await resolveDir(segments, { create: false });
  if (!dir) return [];

  const names: string[] = [];
  // FileSystemDirectoryHandle implements an async iterator (entries()).
  for await (const [entryName, handle] of (
    dir as FileSystemDirectoryHandle & {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries()) {
    names.push(handle.kind === "directory" ? `${entryName}/` : entryName);
  }
  names.sort();
  return names;
}

async function objectUrl(path: string): Promise<string> {
  const file = await readFile(path);
  return URL.createObjectURL(file);
}

async function estimate(): Promise<{ quota: number; usage: number }> {
  const result = await navigator.storage.estimate();
  return {
    quota: result.quota ?? 0,
    usage: result.usage ?? 0,
  };
}

async function wipeAll(): Promise<void> {
  const r = await root();
  for await (const [entryName] of (
    r as FileSystemDirectoryHandle & {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries()) {
    await r.removeEntry(entryName, { recursive: true });
  }
}

export const opfs = {
  writeFile,
  createWritable,
  readFile,
  exists,
  deleteFile,
  deletePath,
  list,
  objectUrl,
  estimate,
  wipeAll,
};

export type Opfs = typeof opfs;
