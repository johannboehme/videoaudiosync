// Studio Console design tokens — warm paper, hot orange, deep cobalt, LCD black.
export const tokens = {
  color: {
    paper: "#F2EDE2",
    paperDeep: "#E8E1D0",
    paperHi: "#FAF6EC",
    panel: "#DDD4BE",
    sunken: "#1A1816",
    sunkenSoft: "#2A2722",

    ink: "#1A1816",
    ink2: "#5C544A",
    ink3: "#9A8F80",
    inkInverse: "#F2EDE2",

    rule: "#C9BFA6",
    ruleSoft: "#D8CFB8",

    hot: "#FF5722",
    hotPressed: "#E04A1C",
    hotSoft: "#FFE3D6",

    cobalt: "#1F4E8C",
    cobaltSoft: "#D6E0EE",

    success: "#2A8A4A",
    warn: "#E5A100",
    danger: "#C0392B",
  },
  radius: {
    xs: "4px",
    sm: "6px",
    md: "10px",
    lg: "14px",
    xl: "20px",
    pill: "999px",
  },
  shadow: {
    emboss: "0 1px 0 rgba(255,255,255,0.6) inset, 0 -1px 0 rgba(0,0,0,0.06) inset, 0 1px 2px rgba(0,0,0,0.06)",
    pressed: "0 1px 1px rgba(0,0,0,0.18) inset, 0 -1px 0 rgba(0,0,0,0.08) inset",
    panel: "0 1px 0 rgba(255,255,255,0.5) inset, 0 1px 2px rgba(0,0,0,0.05)",
    lcd: "0 1px 1px rgba(255,255,255,0.5), 0 1px 2px rgba(0,0,0,0.4) inset",
    knob: "0 6px 12px -4px rgba(0,0,0,0.25), 0 2px 4px -1px rgba(0,0,0,0.15), 0 1px 0 rgba(255,255,255,0.7) inset",
    knobPressed: "0 2px 4px -2px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.5) inset",
    hot: "0 4px 8px -2px rgba(255,87,34,0.45)",
  },
  font: {
    display: '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif',
    body: '"Geist Variable", ui-sans-serif, system-ui, -apple-system, sans-serif',
    mono: '"JetBrains Mono Variable", ui-monospace, "SFMono-Regular", "Menlo", monospace',
  },
} as const;

export type Tokens = typeof tokens;
