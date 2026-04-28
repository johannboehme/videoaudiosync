import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SyncProgressPanel } from "./SyncProgressPanel";
import type { LocalJob } from "../../storage/jobs-db";

function makeJob(overrides: Partial<LocalJob> = {}): LocalJob {
  return {
    id: "abc123",
    title: "Test job",
    videoFilename: "shot1.mp4",
    audioFilename: "song.wav",
    status: "syncing",
    progress: { pct: 10, stage: "syncing-cam-1" },
    hasOutput: false,
    createdAt: Date.now(),
    schemaVersion: 2,
    videos: [
      { id: "cam-1", filename: "shot1.mp4", opfsPath: "x", color: "#FF5722" },
      { id: "cam-2", filename: "shot2.mp4", opfsPath: "y", color: "#1F4E8C" },
    ],
    cuts: [],
    ...overrides,
  };
}

describe("SyncProgressPanel", () => {
  it("renders one strip per cam", () => {
    render(<SyncProgressPanel job={makeJob()} />);
    expect(screen.getByText(/Cam 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Cam 2/i)).toBeInTheDocument();
    expect(screen.getByText("shot1.mp4")).toBeInTheDocument();
    expect(screen.getByText("shot2.mp4")).toBeInTheDocument();
  });

  it("shows the master audio filename", () => {
    render(<SyncProgressPanel job={makeJob()} />);
    expect(screen.getByText("song.wav")).toBeInTheDocument();
  });

  it("renders nothing dramatic for an empty videos array", () => {
    const job = makeJob({ videos: [] });
    const { container } = render(<SyncProgressPanel job={job} />);
    expect(container.querySelector('[data-testid="sync-progress-panel"]')).toBeInTheDocument();
  });

  it("highlights the active cam by stage", () => {
    const { rerender } = render(
      <SyncProgressPanel
        job={makeJob({ progress: { pct: 10, stage: "syncing-cam-1" } })}
      />,
    );
    // cam-1 is active syncing — its status text should be a percentage, not "pending"
    expect(screen.queryByText(/pending/i)).toBeInTheDocument(); // cam-2 pending
    // Switching to cam-2 active
    rerender(
      <SyncProgressPanel
        job={makeJob({ progress: { pct: 50, stage: "syncing-cam-2" } })}
      />,
    );
    expect(screen.getAllByText(/done/i).length).toBeGreaterThanOrEqual(1); // cam-1 done
  });

  it("shows ANALYSE indicator during analyzing-audio stage", () => {
    render(
      <SyncProgressPanel
        job={makeJob({ progress: { pct: 95, stage: "analyzing-audio" } })}
      />,
    );
    expect(screen.getByText(/analyse/i)).toBeInTheDocument();
  });

  it("renders without crashing for a fully-synced job", () => {
    const { container } = render(
      <SyncProgressPanel
        job={makeJob({
          status: "synced",
          progress: { pct: 100, stage: "synced" },
        })}
      />,
    );
    expect(container.querySelector('[data-testid="sync-progress-panel"]')).toBeInTheDocument();
    expect(screen.getAllByText(/done/i).length).toBeGreaterThanOrEqual(2);
  });

  it("renders failed-state without crashing", () => {
    render(
      <SyncProgressPanel
        job={makeJob({
          status: "failed",
          progress: { pct: 50, stage: "syncing-cam-2" },
        })}
      />,
    );
    expect(screen.getByText(/halted/i)).toBeInTheDocument();
  });
});
