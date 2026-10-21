import type { CSSProperties } from 'react';

/**
 * A calm Material 3 determinate bar: the filled part, a small gap, the track with a dot at its end. It does not animate on its own (nothing waves,
 * nothing stacks), only the width follows a changing value, and its box is fixed so a changing number never shifts the lines around it.
 */
export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  const style = { '--p': clamped } as CSSProperties;
  return (
    <div className="v5-progress" style={style} data-full={clamped >= 0.999} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
      <i /><i />
    </div>
  );
}

/** Morphing-shape loading indicator (Material 3 Expressive): one shape that keeps turning into another. */
export function Loader() {
  return <span className="v5-loader" aria-hidden />;
}
