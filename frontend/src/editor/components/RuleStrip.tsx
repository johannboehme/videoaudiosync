// Calibration-style tick strip — horizontal ruler with long marks every 5.
// Decorative element used across pages to give a "measuring instrument" feel.
interface Props {
  count?: number;
  className?: string;
  color?: string;
  longEvery?: number;
}

export function RuleStrip({
  count = 60,
  className = "",
  color = "currentColor",
  longEvery = 5,
}: Props) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${count} 12`}
      preserveAspectRatio="none"
      className={`block w-full h-3 ${className}`}
    >
      {Array.from({ length: count + 1 }).map((_, i) => {
        const isLong = i % longEvery === 0;
        return (
          <line
            key={i}
            x1={i}
            y1={0}
            x2={i}
            y2={isLong ? 12 : 6}
            stroke={color}
            strokeWidth={0.4}
            strokeLinecap="butt"
          />
        );
      })}
    </svg>
  );
}

export function RegistrationMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`block w-4 h-4 ${className}`}
      stroke="currentColor"
      strokeWidth="1"
      fill="none"
    >
      <circle cx="8" cy="8" r="6" />
      <line x1="0" y1="8" x2="16" y2="8" />
      <line x1="8" y1="0" x2="8" y2="16" />
    </svg>
  );
}
