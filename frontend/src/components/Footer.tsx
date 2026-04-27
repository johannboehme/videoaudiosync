import { Link } from "react-router-dom";

interface FooterProps {
  /** Floating overlay style for routes that own a full-bleed canvas (Editor, Render). */
  overlay?: boolean;
}

export function Footer({ overlay = false }: FooterProps) {
  // Both legal links must be "leicht erkennbar, unmittelbar erreichbar und ständig
  // verfügbar" on every route — including the full-bleed editor/render canvases.
  const base =
    "font-display tracking-label uppercase text-[10px] text-ink-2 hover:text-ink";
  if (overlay) {
    return (
      <div className="pointer-events-none fixed bottom-2 right-3 z-40 flex items-center gap-3 rounded-md bg-paper-hi/85 px-2.5 py-1 backdrop-blur-sm shadow-panel">
        <Link to="/impressum" className={`pointer-events-auto ${base}`}>
          Impressum
        </Link>
        <span className="text-ink-3" aria-hidden>
          ·
        </span>
        <Link to="/datenschutz" className={`pointer-events-auto ${base}`}>
          Datenschutz
        </Link>
      </div>
    );
  }
  return (
    <footer className="mt-auto border-t border-rule bg-paper-hi">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-10 flex items-center justify-end gap-3">
        <Link to="/impressum" className={base}>
          Impressum
        </Link>
        <span className="text-ink-3" aria-hidden>
          ·
        </span>
        <Link to="/datenschutz" className={base}>
          Datenschutz
        </Link>
      </div>
    </footer>
  );
}
