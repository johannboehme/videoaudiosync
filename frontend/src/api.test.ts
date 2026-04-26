import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./api";

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload = { onprogress: null as ((e: { loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = "";
  withCredentials = false;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeXhr.instances.push(this);
  }
  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total });
  }
  finish(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

describe("ApiClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: ApiClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    FakeXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    api = new ApiClient("");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("login posts JSON credentials and returns the user", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "u1", email: "a@b.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const user = await api.login("a@b.com", "pw");
    expect(user).toEqual({ id: "u1", email: "a@b.com" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ email: "a@b.com", password: "pw" }),
      }),
    );
  });

  it("login throws ApiError on 401", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid credentials" }), { status: 401 }),
    );
    const err = await api.login("a@b.com", "wrong").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, detail: "Invalid credentials" });
  });

  it("uploadJob POSTs multipart/form-data with both files via XHR", async () => {
    const video = new File(["v"], "test.mp4", { type: "video/mp4" });
    const audio = new File(["a"], "test.wav", { type: "audio/wav" });
    const promise = api.uploadJob({ video, audio, title: "My take" });
    // First (and only) XHR was constructed by uploadJob:
    const xhr = FakeXhr.instances[0];
    expect(xhr.open).toHaveBeenCalledWith("POST", "/api/jobs/upload");
    expect(xhr.send).toHaveBeenCalledTimes(1);
    const body = xhr.send.mock.calls[0][0] as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("video")).toBeInstanceOf(File);
    expect(body.get("audio")).toBeInstanceOf(File);
    expect(body.get("title")).toBe("My take");
    xhr.finish(201, { id: "j1", status: "queued" });
    const job = await promise;
    expect(job.id).toBe("j1");
  });

  it("uploadJob invokes onProgress as bytes are uploaded", async () => {
    const onProgress = vi.fn();
    const video = new File(["v"], "test.mp4", { type: "video/mp4" });
    const audio = new File(["a"], "test.wav", { type: "audio/wav" });
    const promise = api.uploadJob({ video, audio, onProgress });
    const xhr = FakeXhr.instances[0];
    xhr.emitProgress(50, 200);
    xhr.emitProgress(150, 200);
    expect(onProgress).toHaveBeenNthCalledWith(1, 50, 200);
    expect(onProgress).toHaveBeenNthCalledWith(2, 150, 200);
    xhr.finish(201, { id: "j1" });
    await promise;
  });

  it("uploadJob rejects with ApiError on non-2xx status", async () => {
    const video = new File(["v"], "test.mp4", { type: "video/mp4" });
    const audio = new File(["a"], "test.wav", { type: "audio/wav" });
    const promise = api.uploadJob({ video, audio });
    const xhr = FakeXhr.instances[0];
    xhr.finish(413, { detail: "File too large" });
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 413, detail: "File too large" });
  });

  it("uploadJob rejects on network error", async () => {
    const video = new File(["v"], "test.mp4", { type: "video/mp4" });
    const audio = new File(["a"], "test.wav", { type: "audio/wav" });
    const promise = api.uploadJob({ video, audio });
    const xhr = FakeXhr.instances[0];
    xhr.fail();
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
  });

  it("listJobs returns the array", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "j1" }, { id: "j2" }]), { status: 200 }),
    );
    const jobs = await api.listJobs();
    expect(jobs.map((j) => j.id)).toEqual(["j1", "j2"]);
  });

  it("downloadUrl points at the right endpoint", () => {
    expect(api.downloadUrl("j1")).toBe("/api/jobs/j1/download");
  });

  it("submitEdit POSTs the edit spec and returns the updated job", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "j1", status: "queued" }), { status: 200 }),
    );
    const spec = { version: 1 as const, segments: [], overlays: [], visualizer: null };
    const job = await api.submitEdit("j1", spec);
    expect(job.id).toBe("j1");
    const args = fetchMock.mock.calls[0];
    expect(args[0]).toBe("/api/jobs/j1/edit");
    const body = JSON.parse(args[1].body as string);
    expect(body).toEqual({ spec });
  });

  it("deleteJob calls DELETE", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.deleteJob("j1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/j1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
