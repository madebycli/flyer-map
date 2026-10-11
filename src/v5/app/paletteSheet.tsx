import { Icon, SEEDS, schemeFor } from '../../ui/index.ts';
import type { Theme } from '../map/fieldMap.ts';
import { SheetFrame } from './sheet.tsx';

/** Pick the colour of the app (Material You from a seed colour): eight colours or any colour; kept on this device, applied to every page. */
export function PaletteSheet({ seed, theme, onPick, onClose }: { seed: string; theme: Theme; onPick(hex: string): void; onClose(): void }) {
  const custom = !SEEDS.some((s) => s.hex.toLowerCase() === seed.toLowerCase());
  const swatch = (hex: string) => { const scheme = schemeFor(hex, theme); return { background: scheme['primary-container'], color: scheme['on-primary-container'], ['--dot' as string]: scheme.primary }; };
  return (
    <SheetFrame icon="palette" title="Farbe" onClose={onClose}>
      <p className="v5-hint"><Icon name="info" size={20} />Alle Farben der App werden aus einer Grundfarbe gebildet, hell und dunkel. Das gilt nur für dieses Gerät.</p>
      <div className="v5-swatches" role="group" aria-label="Grundfarbe">
        {SEEDS.map((s) => {
          const on = s.hex.toLowerCase() === seed.toLowerCase();
          return (
            <button key={s.id} type="button" className={`v5-swatch${on ? ' on' : ''}`} style={swatch(s.hex)} aria-pressed={on} aria-label={s.name} onClick={() => onPick(s.hex)}>
              <i aria-hidden>{on && <Icon name="check" size={20} />}</i><span>{s.name}</span>
            </button>
          );
        })}
        <label className={`v5-swatch${custom ? ' on' : ''}`} style={swatch(seed)}>
          <i aria-hidden>{custom ? <Icon name="check" size={20} /> : <Icon name="palette" size={20} />}</i><span>Eigene</span>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(seed) ? seed : '#1f8a70'} aria-label="Eigene Grundfarbe" onChange={(event) => onPick(event.target.value)} />
        </label>
      </div>
      <div className="v5-preview" aria-hidden>
        <b>Vorschau</b>
        <span className="p">Primär</span><span className="s">Sekundär</span><span className="t">Akzent</span>
      </div>
    </SheetFrame>
  );
}
