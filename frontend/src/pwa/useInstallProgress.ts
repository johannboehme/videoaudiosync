import { useEffect, useState } from "react";

interface InstallProgress {
  visible: boolean;
  slowMode: boolean;
}

interface InstallProgressOptions {
  /** Hard upper bound — once this many ms have elapsed since the install
   *  would otherwise be gating the UI, the overlay auto-dismisses regardless
   *  of `offlineReady` / `sw.ready` / `controllerchange`. Acts as a final
   *  safety net for SW failure modes the lifecycle hooks can't observe. The
   *  SW continues installing in the background, so losing the overlay
   *  doesn't lose the install. Defaults to 120 s. */
  maxWaitMs?: number;
  /** Force-disable. Caller has decided the overlay should not gate the UI
   *  at all — e.g. dev mode (`vite-plugin-pwa` doesn't register a worker
   *  there, so `sw.ready` would hang and `offlineReady` never flips). */
  disabled?: boolean;
}

const SLOW_MODE_THRESHOLD_MS = 90_000;
// 120 s leaves the slow-mode warning (90 s) about 30 s of breathing room
// to actually be readable before the hard dismiss takes the overlay away.
const DEFAULT_MAX_WAIT_MS = 120_000;

function hasNoControllerAtMount(): boolean {
  if (typeof navigator === "undefined") return false;
  const sw = navigator.serviceWorker;
  if (!sw) return false;
  return sw.controller === null;
}

export function useInstallProgress(
  offlineReady: boolean,
  options: InstallProgressOptions = {},
): InstallProgress {
  const { maxWaitMs = DEFAULT_MAX_WAIT_MS, disabled = false } = options;

  // Initialised at mount: a repeat-visitor whose SW already controls the
  // page must never see the overlay. The flag is later cleared once the
  // SW becomes observably ready (see effect below) — covers the repeat-
  // visit case where `controller` is briefly null at mount.
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

  const [maxWaitElapsed, setMaxWaitElapsed] = useState(false);

  const visible =
    !disabled && installInProgress && !offlineReady && !maxWaitElapsed;

  const [slowMode, setSlowMode] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => setSlowMode(true), SLOW_MODE_THRESHOLD_MS);
    return () => clearTimeout(id);
  }, [visible]);

  // Hard auto-dismiss timer — armed once at mount when an install would
  // otherwise gate the UI. Read maxWaitMs lazily so the dependency array
  // can stay [] and the timer doesn't restart on every render.
  useEffect(() => {
    if (disabled) return;
    if (!installInProgress) return;
    if (offlineReady) return;
    const id = setTimeout(() => setMaxWaitElapsed(true), maxWaitMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { visible, slowMode };
}
