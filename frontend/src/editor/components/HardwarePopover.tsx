/**
 * Brass-nameplate popover. Renders into a body-portal so a parent
 * `overflow-hidden` (e.g. the timeline shell) can't clip it. Position
 * is computed from the trigger element's bounding rect so the popover
 * tracks scroll + resize.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

interface HardwarePopoverProps {
  open: boolean;
  onClose: () => void;
  /** The button (or other element) the popover anchors to. */
  triggerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Horizontal anchor relative to the trigger. Default "left" (left
   *  edge of popover lines up with left edge of trigger). */
  align?: "left" | "right" | "center";
  /** Vertical side relative to the trigger. Default "bottom". */
  side?: "bottom" | "top";
  /** Pixel gap between trigger and popover. */
  offset?: number;
  /** Accessibility label for the popover dialog. */
  ariaLabel?: string;
}

interface Coords {
  top: number;
  left: number;
  transform?: string;
}

export function HardwarePopover({
  open,
  onClose,
  triggerRef,
  children,
  align = "left",
  side = "bottom",
  offset = 8,
  ariaLabel,
}: HardwarePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    function update() {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const top = side === "bottom" ? r.bottom + offset : r.top - offset;
      let left: number;
      const transforms: string[] = [];
      if (align === "left") left = r.left;
      else if (align === "right") left = r.right;
      else {
        left = r.left + r.width / 2;
        transforms.push("translateX(-50%)");
      }
      if (side === "top") transforms.push("translateY(-100%)");
      setCoords({
        top,
        left,
        transform: transforms.length ? transforms.join(" ") : undefined,
      });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, side, align, offset, triggerRef]);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // pointerdown so the close fires before the trigger's click handler
    // toggles `open` again — without that, clicking the trigger to close
    // races with the document handler.
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, triggerRef]);

  if (!open || !coords) return null;
  if (typeof document === "undefined") return null;

  // Brass-nameplate plate language — same vocabulary as the BpmReadout
  // bezel so the popover reads as "the panel slid open" instead of a
  // generic dropdown.
  const plateStyle: React.CSSProperties = {
    background:
      "linear-gradient(180deg, #FAF6EC 0%, #E8E1D0 50%, #C9BFA6 100%)",
    boxShadow: [
      "inset 0 1px 0 rgba(255,255,255,0.85)",
      "inset 0 -1px 0 rgba(0,0,0,0.18)",
      "0 8px 24px rgba(0,0,0,0.28)",
      "0 2px 6px rgba(0,0,0,0.18)",
    ].join(", "),
    borderRadius: 6,
    padding: 8,
    transformOrigin: side === "bottom" ? "top center" : "bottom center",
    animation: "hardware-popover-in 130ms ease-out",
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        transform: coords.transform,
        zIndex: 50,
      }}
    >
      <div className="border border-rule" style={plateStyle}>
        {children}
      </div>
      <style>{`
        @keyframes hardware-popover-in {
          from { opacity: 0; transform: ${coords.transform ?? ""} translateY(-3px) scaleY(0.95); }
          to   { opacity: 1; transform: ${coords.transform ?? ""} translateY(0) scaleY(1); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
