// Typed client for the videoaudiosync HTTP API + SSE helper.

export interface User {
  id: string;
  email: string;
}

export type JobStatus =
  | "queued"
  | "analyzing"
  | "syncing"
  | "rendering"
  | "done"
  | "failed"
  | "expired";

export interface Job {
  id: string;
  status: JobStatus;
  kind: "sync" | "edit";
  title: string | null;
  video_filename: string;
  audio_filename: string;
  sync_offset_ms: number | null;
  sync_confidence: number | null;
  sync_drift_ratio: number | null;
  sync_warning: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  progress_pct: number;
  progress_stage: string;
  progress_detail: string | null;
  progress_eta_s: number | null;
  error: string | null;
  edit_spec: EditSpec | null;
  has_output: boolean;
  bytes_in: number;
  bytes_out: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Segment {
  in: number;
  out: number;
}

export interface ReactiveModulation {
  band: "bass" | "low_mids" | "mids" | "highs";
  param: "scale" | "y" | "rotate";
  amount: number;
}

export interface TextOverlay {
  type: "text";
  text: string;
  start: number;
  end: number;
  preset?: "plain" | "boxed" | "outline" | "glow" | "gradient";
  x?: number;
  y?: number;
  animation?: "fade" | "pop" | "slide_in" | "word_reveal" | "wobble" | "none";
  reactive?: ReactiveModulation;
}

export interface VisualizerConfig {
  type: "showcqt" | "showfreqs" | "showwaves" | "showspectrum" | "avectorscope";
  position?: "top" | "center" | "bottom";
  height_pct?: number;
  opacity?: number;
}

export interface EditSpec {
  version: 1;
  segments: Segment[];
  overlays: TextOverlay[];
  visualizer: VisualizerConfig | null;
}

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`API ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

async function asJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(resp.status, detail);
  }
  return (await resp.json()) as T;
}

export class ApiClient {
  baseUrl: string;
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  // ---- auth ----

  async login(email: string, password: string): Promise<User> {
    const resp = await fetch(this.url("/api/auth/login"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return asJson<User>(resp);
  }

  async logout(): Promise<void> {
    await fetch(this.url("/api/auth/logout"), {
      method: "POST",
      credentials: "same-origin",
    });
  }

  async me(): Promise<User | null> {
    try {
      const resp = await fetch(this.url("/api/auth/me"), { credentials: "same-origin" });
      if (resp.status === 401) return null;
      return await asJson<User>(resp);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }

  // ---- jobs ----

  uploadJob(args: {
    video: File;
    audio: File;
    title?: string;
    onProgress?: (loaded: number, total: number) => void;
  }): Promise<Job> {
    const fd = new FormData();
    fd.set("video", args.video);
    fd.set("audio", args.audio);
    if (args.title) fd.set("title", args.title);
    return new Promise<Job>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", this.url("/api/jobs/upload"));
      xhr.withCredentials = true;
      if (args.onProgress) {
        xhr.upload.onprogress = (e) => args.onProgress!(e.loaded, e.total);
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as Job);
          } catch {
            reject(new ApiError(xhr.status, "Malformed response"));
          }
          return;
        }
        let detail = xhr.statusText || `HTTP ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body && typeof body.detail === "string") detail = body.detail;
        } catch {
          /* ignore */
        }
        reject(new ApiError(xhr.status, detail));
      };
      xhr.onerror = () => reject(new ApiError(0, "Network error"));
      xhr.onabort = () => reject(new ApiError(0, "Upload aborted"));
      xhr.send(fd);
    });
  }

  async listJobs(): Promise<Job[]> {
    const resp = await fetch(this.url("/api/jobs"), { credentials: "same-origin" });
    return asJson<Job[]>(resp);
  }

  async getJob(id: string): Promise<Job> {
    const resp = await fetch(this.url(`/api/jobs/${id}`), { credentials: "same-origin" });
    return asJson<Job>(resp);
  }

  async deleteJob(id: string): Promise<void> {
    const resp = await fetch(this.url(`/api/jobs/${id}`), {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!resp.ok && resp.status !== 204) {
      throw new ApiError(resp.status, resp.statusText);
    }
  }

  async submitEdit(id: string, spec: EditSpec): Promise<Job> {
    const resp = await fetch(this.url(`/api/jobs/${id}/edit`), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    return asJson<Job>(resp);
  }

  downloadUrl(id: string): string {
    return this.url(`/api/jobs/${id}/download`);
  }

  previewUrl(id: string): string {
    return this.url(`/api/jobs/${id}/preview`);
  }

  waveformUrl(id: string): string {
    return this.url(`/api/jobs/${id}/waveform`);
  }

  thumbnailsUrl(id: string): string {
    return this.url(`/api/jobs/${id}/thumbnails`);
  }

  // ---- progress SSE ----

  subscribeJob(
    id: string,
    onEvent: (event: {
      stage?: string;
      progress?: number;
      status?: string;
      error?: string;
      detail?: string | null;
      eta_s?: number | null;
    }) => void,
  ): () => void {
    const es = new EventSource(this.url(`/api/jobs/${id}/events`), {
      withCredentials: true,
    });
    const handler = (e: MessageEvent) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        /* swallow malformed event */
      }
    };
    es.addEventListener("progress", handler as EventListener);
    es.addEventListener("state", handler as EventListener);
    return () => es.close();
  }
}

export const api = new ApiClient();
