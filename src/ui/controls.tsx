import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';

/**
 * The building blocks of lists and settings, so every page looks and behaves the same way:
 * `ListGroup` (a titled block of rows), `ListRow` (one line: icon, text, badge, chevron) and `SwitchRow` (an on/off setting). Choices use `Segmented` from the kit.
 * Every control is one height (`--ctl`) and one radius (`--r`); nothing here moves when a state changes.
 */
export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="v5-group" aria-label={title}>
      {title && <h3 className="v5-group-title">{title}</h3>}
      <div className="v5-group-rows">{children}</div>
    </section>
  );
}

type RowProps = { icon: IconName; label: string; hint?: string; badge?: number | string; chevron?: boolean; tone?: 'default' | 'primary'; trailing?: ReactNode; onClick?: () => void; href?: string; disabled?: boolean };
export function ListRow({ icon, label, hint, badge, chevron = true, tone = 'default', trailing, onClick, href, disabled }: RowProps) {
  const body = (
    <>
      <span className="v5-row-ico"><Icon name={icon} size={24} /></span>
      <span className="v5-row-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      {badge !== undefined && badge !== 0 && <em className="v5-row-badge">{badge}</em>}
      {trailing}
      {chevron && <Icon name="chevron" size={20} className="v5-row-chev" />}
    </>
  );
  const cls = `v5-grow${tone === 'primary' ? ' primary' : ''}`;
  return href
    ? <a className={cls} href={href} aria-label={label}>{body}</a>
    : <button className={cls} onClick={onClick} disabled={disabled} aria-label={label}>{body}</button>;
}

export function SwitchRow({ icon, label, hint, checked, onChange }: { icon: IconName; label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button className="v5-grow" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="v5-row-ico"><Icon name={icon} size={24} /></span>
      <span className="v5-row-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <span className={`v5-switch${checked ? ' on' : ''}`} aria-hidden><i /></span>
    </button>
  );
}
