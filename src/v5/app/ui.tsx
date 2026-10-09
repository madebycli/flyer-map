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
  tap: <><circle cx="12" cy="12" r="2.6" /><circle cx="12" cy="12" r="8" /></>,
  brush: <><path d="M9.5 14.5L19 5a2 2 0 0 1 2.8 2.8L12.5 17" /><path d="M4 20c3.2 0 5.3-1.6 5.3-4.1 0-1.2-.9-2-2-2s-2.1.9-2.1 2.3c0 1.6-.4 2.8-1.2 3.8z" /></>,
  lasso: <><path d="M12 4c5 0 8 2.2 8 5s-3 5.2-8 5.2S4 11.8 4 9s3-5 8-5z" strokeDasharray="3.2 2.6" /><path d="M8 13.6c-.9 1.9-.4 4 2.2 5.4" /></>,
  polygon: <><path d="M5 8.5L12 4l7 5-2.2 9.5H8z" /><circle cx="5" cy="8.5" r="1.3" /><circle cx="12" cy="4" r="1.3" /><circle cx="19" cy="9" r="1.3" /><circle cx="16.8" cy="18.5" r="1.3" /><circle cx="8" cy="18.5" r="1.3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10.5 11v5.5M13.5 11v5.5" />,
  pen: <path d="M4 20l1-4.5L16.5 4a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19z M14.5 6l3.5 3.5" />,
  more: <><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></>,
  hand: <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1.5V5a1.5 1.5 0 0 1 3 0v5m0-3a1.5 1.5 0 0 1 3 0v6.5a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3.6 14a1.6 1.6 0 0 1 2.6-1.8L8 14" />,
  shield: <path d="M12 3.5l7 2.8v5.4c0 4.3-2.8 7.4-7 8.8-4.2-1.4-7-4.5-7-8.8V6.3z M9 12l2.2 2.2L15.2 10" />,
  users: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.3-3 2.5-4.8 5.5-4.8s5.2 1.800 5.500 4.800" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16.5 14.4c2.400.1 3.800 1.600 4 4" /></>,
  message: <path d="M4 5.5h16v10.5H9.500L5 19.800V16H4z M8 9.500h8M8 12.500h5" />,
  flag: <path d="M6 20.500V4.500M6 5.500h11l-2 3.500 2 3.500H6" />,
  paw: <><circle cx="6.5" cy="10.5" r="1.8" /><circle cx="10" cy="6.5" r="1.8" /><circle cx="14" cy="6.5" r="1.8" /><circle cx="17.5" cy="10.5" r="1.8" /><path d="M12 12.5c-3 0-5.5 2.700-5.500 4.700 0 1.600 1.500 2.300 3 2 .9-.2 1.600-.5 2.500-.5s1.600.3 2.500.5c1.500.3 3-.4 3-2 0-2-2.500-4.700-5.500-4.700z" /></>,
  lock: <><rect x="5.500" y="10.500" width="13" height="9.500" rx="2.500" /><path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500M12 14.500v2" /></>,
  noAds: <><circle cx="12" cy="12" r="8.500" /><path d="M6 6l12 12M8.500 10.500h2.500M8.500 13.500h5" /></>,
  mailbox: <><path d="M4 18.500V10a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v8.500zM4 18.500h16M12 13V5M15 5h3" /></>,
  repeat: <path d="M4 12a6 6 0 0 1 6-6h8M15 3l3 3-3 3M20 12a6 6 0 0 1-6 6H6M9 21l-3-3 3-3" />,
  info: <><circle cx="12" cy="12" r="8.500" /><path d="M12 11v5.500M12 7.700v.1" /></>,
  send: <path d="M4 12L20 4l-4.500 16-3.500-6.500zM12 13.500L20 4" />,
  exit: <path d="M10 4.500H6.500A1.500 1.500 0 0 0 5 6v12a1.500 1.500 0 0 0 1.500 1.500H10M14 8.500l3.500 3.500-3.500 3.500M17.500 12H9.500" />,
  unlock: <><rect x="5.500" y="10.500" width="13" height="9.500" rx="2.500" /><path d="M8.500 10.500V8a3.500 3.500 0 0 1 6.600-1.600M12 14.500v2" /></>,
  locate: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7.5" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>,
  minus: <path d="M5 12h14" />,
  compass: <><circle cx="12" cy="12" r="8.5" /><path d="M15.2 8.8l-1.6 4.8-4.8 1.6 1.6-4.8z" /></>,
  grid: <><rect x="4.5" y="4.5" width="6" height="6" rx="1.6" /><rect x="13.5" y="4.5" width="6" height="6" rx="1.6" /><rect x="4.5" y="13.5" width="6" height="6" rx="1.6" /><rect x="13.5" y="13.5" width="6" height="6" rx="1.6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>,
  chart: <path d="M5 20V11M12 20V5M19 20v-6" />,
  layers: <path d="M12 4l8.500 4.500L12 13 3.500 8.500zM3.500 12.500L12 17l8.500-4.500M3.500 16L12 20.500 20.500 16" />,
  swap: <path d="M7 4L3.500 7.500 7 11M3.500 7.500H20M17 13l3.500 3.500L17 20M20.500 16.500H4" />,
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
