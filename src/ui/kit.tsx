import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { Loader } from './progress.tsx';

/**
 * Page kit for everything that is not the map: sign-in, organiser admin, security, invitations.
 * Same tokens and shapes as the field shell (rounded, tonal, one control height), one scrollable column on a phone.
 */

export function Page({ bar, narrow = false, children }: { bar?: ReactNode; narrow?: boolean; children: ReactNode }) {
  return (
    <div className="ui-page">
      {bar}
      <main className={`ui-main${narrow ? ' narrow' : ''}`}>{children}</main>
    </div>
  );
}

/** A short centred page (sign-in, invitation): brand on top, one card. */
export function CenterPage({ children }: { children: ReactNode }) {
  return (
    <div className="ui-page center">
      <header className="ui-bar"><a className="ui-brand" href="/login"><Icon name="mailbox" size={24} />Flyer Map</a></header>
      <main className="ui-main narrow">{children}</main>
    </div>
  );
}

export type NavItem = { label: string; href?: string; onClick?: () => void; current?: boolean };

export function AppBar({ nav, account, onBrand }: { nav: NavItem[]; account?: ReactNode; onBrand?: () => void }) {
  return (
    <header className="ui-bar">
      {onBrand
        ? <button className="ui-brand" type="button" onClick={onBrand}><Icon name="mailbox" size={24} />Flyer Map</button>
        : <a className="ui-brand" href="/admin"><Icon name="mailbox" size={24} />Flyer Map</a>}
      <nav aria-label="Organizer Navigation">
        {nav.map((item) => item.href
          ? <a key={item.label} href={item.href} aria-current={item.current ? 'page' : undefined}>{item.label}</a>
          : <button key={item.label} type="button" onClick={item.onClick} aria-current={item.current ? 'page' : undefined}>{item.label}</button>)}
      </nav>
      {account ? <div className="ui-account">{account}</div> : null}
    </header>
  );
}

export function Heading({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-heading">
      <div>{eyebrow ? <span className="ui-eyebrow">{eyebrow}</span> : null}<h1>{title}</h1></div>
      {children ? <div className="ui-heading-actions">{children}</div> : null}
    </div>
  );
}

export function Card({ title, eyebrow, icon, children, tone }: { title?: ReactNode; eyebrow?: string; icon?: IconName; children: ReactNode; tone?: 'warn' }) {
  return (
    <section className={`ui-card${tone ? ` ${tone}` : ''}`}>
      {title || eyebrow ? (
        <header>
          {icon ? <span className="v5-badge"><Icon name={icon} size={24} /></span> : null}
          <div>{eyebrow ? <span className="ui-eyebrow">{eyebrow}</span> : null}{title ? <h2>{title}</h2> : null}</div>
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'warn' | 'ok'; children: ReactNode }) {
  const icon: IconName = tone === 'error' || tone === 'warn' ? 'warning' : tone === 'ok' ? 'check' : 'info';
  return <p className={`ui-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon name={icon} size={20} /><span>{children}</span></p>;
}

export function Loading({ children }: { children: ReactNode }) {
  return <div className="ui-loading" role="status"><Loader /><span>{children}</span></div>;
}

/** A label wrapping its control (so the control is named for assistive tech and tests alike). */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return <label className="ui-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={`ui-input${className ? ` ${className}` : ''}`} {...rest} />;
});

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ui-input${className ? ` ${className}` : ''}`} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`ui-input area${className ? ` ${className}` : ''}`} {...rest} />;
}

export function Check({ label, hint, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; hint?: ReactNode }) {
  return <label className="ui-check"><input type="checkbox" {...rest} /><span>{label}{hint ? <small>{hint}</small> : null}</span></label>;
}

export function Radio({ label, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return <label className="ui-check"><input type="radio" {...rest} /><span>{label}</span></label>;
}

export function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return <fieldset className="ui-group"><legend>{legend}</legend>{children}</fieldset>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'tonal' | 'danger' | 'quiet'; icon?: IconName; busy?: boolean };

export function Button({ tone = 'tonal', icon, busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button className={`ui-btn ${tone}${className ? ` ${className}` : ''}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {icon ? <Icon name={icon} size={20} /> : null}{children}
    </button>
  );
}

export function LinkButton({ tone = 'tonal', icon, href, children }: { tone?: ButtonProps['tone']; icon?: IconName; href: string; children: ReactNode }) {
  return <a className={`ui-btn ${tone}`} href={href}>{icon ? <Icon name={icon} size={20} /> : null}{children}</a>;
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="ui-seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/** One list row: title + secondary text on the left, actions on the right. */
export function Row({ title, text, children }: { title: ReactNode; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-row">
      <div className="ui-row-text"><strong>{title}</strong>{text ? <small>{text}</small> : null}</div>
      {children ? <div className="ui-row-actions">{children}</div> : null}
    </div>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="ui-facts">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Chip({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={`ui-chip${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

/** A modal sheet over the page; Escape and the scrim close it. Focus goes to the dialog when it opens. */
export function Dialog({ title, eyebrow, onClose, children }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ui-scrim" role="presentation" onMouseDown={onClose}>
      <section className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby={id} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>{eyebrow ? <span className="ui-eyebrow">{eyebrow}</span> : null}<h2 id={id}>{title}</h2></div>
          <button className="v5-icon-btn" type="button" onClick={onClose} aria-label="Dialog schließen"><Icon name="close" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

/** Secret text shown once (recovery codes, one-time links): monospace block with a copy button. */
export function Secret({ value, copyLabel = 'Kopieren' }: { value: string; copyLabel?: string }) {
  return (
    <div className="ui-secret">
      <pre>{value}</pre>
      <Button icon="upload" onClick={() => void navigator.clipboard.writeText(value)}>{copyLabel}</Button>
    </div>
  );
}
