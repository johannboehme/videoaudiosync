import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./api";

describe("ApiClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: ApiClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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

  it("uploadJob sends multipart/form-data with both files", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "j1", status: "queued" }), { status: 201 }),
    );
    const video = new File(["v"], "test.mp4", { type: "video/mp4" });
    const audio = new File(["a"], "test.wav", { type: "audio/wav" });
    const job = await api.uploadJob({ video, audio, title: "My take" });
    expect(job.id).toBe("j1");
    const args = fetchMock.mock.calls[0];
    expect(args[0]).toBe("/api/jobs/upload");
    expect(args[1].method).toBe("POST");
    const body = args[1].body as FormData;
    expect(body.get("video")).toBeInstanceOf(File);
    expect(body.get("audio")).toBeInstanceOf(File);
    expect(body.get("title")).toBe("My take");
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
