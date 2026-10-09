import type { CSSProperties } from 'react';

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
