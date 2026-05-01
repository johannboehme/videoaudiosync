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
  const [installInProgress, setInstallInProgress] = useState<boolean>(
    hasNoControllerAtMount,
  );

  // `offlineReady` from vite-plugin-pwa only fires on the very first SW
  // install. On repeat visits where `controller` is briefly null at mount
  // (shift-reload, or before the existing SW claims this client) it never
  // fires — and the overlay would hang. Hide as soon as the SW is otherwise
  // observably ready or starts controlling this page.
  useEffect(() => {
    if (!installInProgress) return;
    if (typeof navigator === "undefined") return;
    const sw = navigator.serviceWorker;
    if (!sw) return;

    let cancelled = false;
    const finish = () => {
      if (!cancelled) setInstallInProgress(false);
    };

    if (sw.ready && typeof sw.ready.then === "function") {
      sw.ready
        .then((registration) => {
          if (registration?.active) finish();
        })
        .catch(() => undefined);
    }

    const onControllerChange = () => {
      if (sw.controller) finish();
    };
    if (typeof sw.addEventListener === "function") {
      sw.addEventListener("controllerchange", onControllerChange);
    }

    return () => {
      cancelled = true;
      if (typeof sw.removeEventListener === "function") {
        sw.removeEventListener("controllerchange", onControllerChange);
      }
    };
  }, [installInProgress]);

  const visible = installInProgress && !offlineReady;

  const [slowMode, setSlowMode] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => setSlowMode(true), SLOW_MODE_THRESHOLD_MS);
    return () => clearTimeout(id);
  }, [visible]);

  return { visible, slowMode };
}
