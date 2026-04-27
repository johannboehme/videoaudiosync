import { describe, it, expect, beforeEach } from "vitest";
import { opfs } from "./opfs";

/**
 * OPFS-Wrapper-Tests gegen echtes Chromium-OPFS.
 *
 * Wichtig: OPFS ist in jsdom NICHT verfügbar — diese Tests müssen im
 * browser-Workspace laufen. Mocking wäre wertlos, weil das ganze Risiko in
 * Edge-Cases der echten Implementation liegt (Verzeichnis-Erstellung,
 * Append-Modus, atomare Schreibvorgänge, Quota).
 *
 * Jeder Test wischt zuerst alles weg, damit Tests reproduzierbar sind und
 * sich nicht gegenseitig beeinflussen (OPFS ist persistent über Page-Loads
 * hinweg, aber jeder vitest-browser-Lauf bekommt einen frischen Origin).
 */
describe("opfs wrapper (real Chromium OPFS)", () => {
  beforeEach(async () => {
    await opfs.wipeAll();
  });

  describe("writeFile + readFile", () => {
    it("writes a Blob and reads it back identically", async () => {
      const original = new Blob(["hello world"], { type: "text/plain" });
      await opfs.writeFile("hello.txt", original);

      const read = await opfs.readFile("hello.txt");
      const text = await read.text();
      expect(text).toBe("hello world");
    });

    it("writes an ArrayBuffer and reads it back as a File with correct size", async () => {
      const buf = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]).buffer;
      await opfs.writeFile("bin.dat", buf);

      const read = await opfs.readFile("bin.dat");
      expect(read.size).toBe(6);
      const back = new Uint8Array(await read.arrayBuffer());
      expect(Array.from(back)).toEqual([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
    });

    it("creates intermediate directories automatically", async () => {
      await opfs.writeFile("jobs/abc123/video.mp4", new Blob(["v"]));
      await opfs.writeFile("jobs/abc123/audio.wav", new Blob(["a"]));

      const v = await opfs.readFile("jobs/abc123/video.mp4");
      const a = await opfs.readFile("jobs/abc123/audio.wav");
      expect(await v.text()).toBe("v");
      expect(await a.text()).toBe("a");
    });

    it("overwrites an existing file (not append)", async () => {
      await opfs.writeFile("x.txt", new Blob(["first"]));
      await opfs.writeFile("x.txt", new Blob(["second"]));

      const f = await opfs.readFile("x.txt");
      expect(await f.text()).toBe("second");
    });
  });

  describe("exists", () => {
    it("returns false for missing file", async () => {
      expect(await opfs.exists("nope.txt")).toBe(false);
    });

    it("returns true after a write", async () => {
      await opfs.writeFile("here.txt", new Blob(["x"]));
      expect(await opfs.exists("here.txt")).toBe(true);
    });

    it("returns false for missing nested file even when ancestor dir exists", async () => {
      await opfs.writeFile("dir/known.txt", new Blob(["x"]));
      expect(await opfs.exists("dir/unknown.txt")).toBe(false);
    });
  });

  describe("delete + wipe", () => {
    it("deletes a single file", async () => {
      await opfs.writeFile("doomed.txt", new Blob(["x"]));
      expect(await opfs.exists("doomed.txt")).toBe(true);

      await opfs.deleteFile("doomed.txt");
      expect(await opfs.exists("doomed.txt")).toBe(false);
    });

    it("deletePath('jobs/X') removes the whole job directory and all contents", async () => {
      await opfs.writeFile("jobs/X/video.mp4", new Blob(["v"]));
      await opfs.writeFile("jobs/X/audio.wav", new Blob(["a"]));
      await opfs.writeFile("jobs/X/subdir/extra.bin", new Blob(["e"]));

      await opfs.deletePath("jobs/X");
      expect(await opfs.exists("jobs/X/video.mp4")).toBe(false);
      expect(await opfs.exists("jobs/X/audio.wav")).toBe(false);
      expect(await opfs.exists("jobs/X/subdir/extra.bin")).toBe(false);
    });

    it("deleteFile on a missing file does not throw", async () => {
      await expect(opfs.deleteFile("ghost.txt")).resolves.toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns sorted file names in a directory", async () => {
      await opfs.writeFile("jobs/Y/c.txt", new Blob([""]));
      await opfs.writeFile("jobs/Y/a.txt", new Blob([""]));
      await opfs.writeFile("jobs/Y/b.txt", new Blob([""]));

      const names = await opfs.list("jobs/Y");
      expect(names).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("returns empty array for missing directory", async () => {
      expect(await opfs.list("nowhere")).toEqual([]);
    });

    it("includes nested directories with a trailing slash marker", async () => {
      await opfs.writeFile("root/file.txt", new Blob([""]));
      await opfs.writeFile("root/sub/inside.txt", new Blob([""]));

      const names = await opfs.list("root");
      expect(names).toContain("file.txt");
      expect(names).toContain("sub/");
    });
  });

  describe("objectUrl", () => {
    it("returns a usable blob URL for a stored file", async () => {
      await opfs.writeFile("playable.txt", new Blob(["payload"], { type: "text/plain" }));

      const url = await opfs.objectUrl("playable.txt");
      try {
        expect(url).toMatch(/^blob:/);
        const fetched = await fetch(url);
        expect(await fetched.text()).toBe("payload");
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });

  describe("estimate", () => {
    it("reports quota and usage as numbers", async () => {
      const e = await opfs.estimate();
      expect(typeof e.quota).toBe("number");
      expect(typeof e.usage).toBe("number");
      expect(e.quota).toBeGreaterThan(0);
      expect(e.usage).toBeGreaterThanOrEqual(0);
    });
  });
});
