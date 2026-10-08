import type { CSSProperties, ReactNode } from 'react';

/** Own stroke icon set (24 px grid, 2 px round strokes): no icon font, no network, themable via currentColor. */
const PATHS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  later: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  blocked: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  open: <circle cx="12" cy="12" r="8.5" strokeDasharray="3.1 3.4" />,
  route: <><circle cx="6" cy="17.5" r="1.9" /><circle cx="18" cy="6.5" r="1.9" /><path d="M7.9 17.5C15 17.5 9 6.5 16.1 6.5" /></>,
  undo: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  house: <path d="M4 11.5L12 4.5l8 7M6.5 10v9.5h11V10" />,
  road: <path d="M8.5 4L5 20M15.5 4L19 20M12 5.5v2.5M12 11v2M12 16v2.5" />,
  cloudOk: <><path d="M7 18.5a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.2a4.7 4.7 0 0 1 0 9.3H7z" /><path d="M9.6 13.8l1.9 1.9 3.3-3.6" /></>,
  cloudOff: <><path d="M7 18.5a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.2a4.7 4.7 0 0 1 0 9.3H7z" /><path d="M4 4l16 16" /></>,
  sync: <path d="M20 11a8 8 0 0 0-14.5-3M4 4v4h4M4 13a8 8 0 0 0 14.5 3M20 20v-4h-4" />,
  download: <path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  warning: <path d="M12 4l9 16H3zM12 10v4.5M12 17.4v.1" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></>,
  ruler: <path d="M3.5 15.5l12-12 5 5-12 12zM8 11l2 2M11 8l2 2M5.5 13.5l1.5 1.5" />,
  mapPin: <><path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`v5-icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** Material 3 Expressive style wavy linear progress: the filled part waves, the rest is a calm track. */
export function WavyProgress({ value, label }: { value: number; label: string }) {
  const style = { '--p': Math.max(0, Math.min(1, value)) } as CSSProperties;
  return (
    <div className="v5-wave" style={style} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <i className="v5-wave-track" />
      <i className="v5-wave-fill" />
    </div>
  );
}

/** Morphing-shape loading indicator (Material 3 Expressive): one shape that keeps turning into another. */
export function Loader() {
  return <span className="v5-loader" aria-hidden />;
}
