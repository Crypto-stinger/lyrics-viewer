import { useId } from "react";

interface LogoProps {
  className?: string;
  size?: number;
  title?: string;
  /** When true, renders in `currentColor` (no gradient) for monochrome contexts. */
  monochrome?: boolean;
}

/**
 * Lyra mark — a four-blade pinwheel orbiting a bright central star, echoing the
 * Justin Stark Media parent brand. Tri-stop aurora gradient (cyan → purple →
 * magenta) when in colour mode; collapses to `currentColor` when `monochrome`.
 * The symbol also maps onto the Lyra constellation: the central glow is Vega
 * and the four blades are the parallelogram of Sheliak / Sulafat / Zeta / Delta
 * Lyrae reinterpreted as motion arcs.
 */
export function Logo({ className, size = 22, title = "Lyra", monochrome = false }: LogoProps) {
  const reactId = useId();
  const gradId = `lyra-grad-${reactId}`;
  const stroke = monochrome ? "currentColor" : `url(#${gradId})`;
  const dot = monochrome ? "currentColor" : "#F0ABFC";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      {!monochrome && (
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22D3EE" />
            <stop offset="50%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
        </defs>
      )}
      <g
        fill="none"
        stroke={stroke}
        strokeWidth={3.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* One blade, rotated four times around centre (32,32). */}
        <path d="M32 32 C 26 22, 38 12, 50 14 C 52 26, 42 38, 32 32 Z" />
        <path
          d="M32 32 C 26 22, 38 12, 50 14 C 52 26, 42 38, 32 32 Z"
          transform="rotate(90 32 32)"
        />
        <path
          d="M32 32 C 26 22, 38 12, 50 14 C 52 26, 42 38, 32 32 Z"
          transform="rotate(180 32 32)"
        />
        <path
          d="M32 32 C 26 22, 38 12, 50 14 C 52 26, 42 38, 32 32 Z"
          transform="rotate(270 32 32)"
        />
      </g>
      {/* Central star (Vega) */}
      <circle cx="32" cy="32" r="3.6" fill={dot} />
    </svg>
  );
}
