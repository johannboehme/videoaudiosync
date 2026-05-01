import { useEffect, useState } from "react";

interface InstallProgress {
  visible: boolean;
  slowMode: boolean;
}

const SLOW_MODE_THRESHOLD_MS = 90_000;

function hasNoControllerAtMount(): boolean {
  if (typeof navigator === "undefined") return false;
  const sw = navigator.serviceWorker;
  if (!sw) return false;
  return sw.controller === null;
}

export function useInstallProgress(offlineReady: boolean): InstallProgress {
  // Captured once at mount. A repeat-visitor whose SW already controls the
  // page must never see the overlay, even if some later effect briefly
  // observes a null controller (e.g. during a page-cache restore).
  const [installInProgress] = useState<boolean>(hasNoControllerAtMount);

  const visible = installInProgress && !offlineReady;

  const [slowMode, setSlowMode] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => setSlowMode(true), SLOW_MODE_THRESHOLD_MS);
    return () => clearTimeout(id);
  }, [visible]);

  return { visible, slowMode };
}
