// Tabbed container for the four right-side panels.
import { ReactNode } from "react";
import { PanelTab, useEditorStore } from "../store";

interface Props {
  sync: ReactNode;
  trim: ReactNode;
  overlays: ReactNode;
  exportTab: ReactNode;
}

const TABS: { value: PanelTab; label: string }[] = [
  { value: "sync", label: "SYNC" },
  { value: "trim", label: "TRIM" },
  { value: "overlays", label: "OVERLAYS" },
  { value: "export", label: "EXPORT" },
];

export function SidePanel({ sync, trim, overlays, exportTab }: Props) {
  const activeTab = useEditorStore((s) => s.ui.activePanel);
  const setActive = useEditorStore((s) => s.setActivePanel);

  let body: ReactNode;
  switch (activeTab) {
    case "sync":
      body = sync;
      break;
    case "trim":
      body = trim;
      break;
    case "overlays":
      body = overlays;
      break;
    case "export":
      body = exportTab;
      break;
  }

  return (
    <div className="flex flex-col h-full bg-paper-hi rounded-lg border border-rule shadow-panel overflow-hidden">
      <nav role="tablist" className="grid grid-cols-4 border-b border-rule bg-paper-deep">
        {TABS.map((t) => {
          const active = t.value === activeTab;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => setActive(t.value)}
              className={[
                "h-11 font-display tracking-label uppercase text-[11px] relative",
                active ? "bg-paper-hi text-ink" : "text-ink-2 hover:text-ink",
              ].join(" ")}
            >
              {t.label}
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-hot" />
              )}
            </button>
          );
        })}
      </nav>
      <div className="flex-1 overflow-auto p-4">{body}</div>
    </div>
  );
}
