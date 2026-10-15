import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../../ui/index.ts';

export type MenuItem = { label: string; icon: IconName; onSelect(): void; danger?: boolean; disabled?: boolean; note?: string };

/** The "more" button of a sheet's header: rare and destructive actions live here instead of taking a full-width row of the sheet. */
export function OverflowMenu({ items, label = 'Weitere Aktionen' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key); };
  }, [open]);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="v5-menuwrap" ref={wrap}>
      <button type="button" className={`v5-icon-btn${open ? ' tonal' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={label} title={label}><Icon name="more" /></button>
      {open && (
        <div className="v5-menu" role="menu" aria-label={label}>
          {shown.map((item) => (
            <button key={item.label} type="button" role="menuitem" className={`v5-menuitem${item.danger ? ' danger' : ''}`} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }}>
              <Icon name={item.icon} size={22} /><span>{item.label}{item.note && <small>{item.note}</small>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
