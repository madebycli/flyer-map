import type { ReactNode } from "react";
import "./field-action-bar.css";

type Props = {
  canCreateArea: boolean;
  onCreateArea?: () => void;
  onSettings: () => void;
  onTeams: () => void;
  onMenu: () => void;
  labels: {
    createArea: string;
    settings: string;
    teams: string;
    menu: string;
  };
};

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className="field-icon-action" type="button" onClick={onClick} aria-label={label} title={label}>
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="M19 13.2v-2.4l-2-.6a7.4 7.4 0 0 0-.7-1.6l1-1.8-1.7-1.7-1.8 1a7.4 7.4 0 0 0-1.6-.7L11.6 3H9.2l-.6 2a7.4 7.4 0 0 0-1.6.7l-1.8-1-1.7 1.7 1 1.8a7.4 7.4 0 0 0-.7 1.6l-2 .6v2.4l2 .6c.2.6.4 1.1.7 1.6l-1 1.8 1.7 1.7 1.8-1c.5.3 1 .5 1.6.7l.6 2h2.4l.6-2c.6-.2 1.1-.4 1.6-.7l1.8 1 1.7-1.7-1-1.8c.3-.5.5-1 .7-1.6l2-.6Z" />
    </svg>
  );
}

function TeamsIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M3.5 19c.4-3.5 2.4-5.3 5.5-5.3s5.1 1.8 5.5 5.3" />
      <path d="M14.2 14.8c.8-.6 1.8-.9 2.9-.9 2.4 0 3.8 1.4 4.2 4" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <circle cx="6" cy="6" r="1.5" />
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="18" cy="6" r="1.5" />
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
      <circle cx="6" cy="18" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
      <circle cx="18" cy="18" r="1.5" />
    </svg>
  );
}

export function FieldActionBar({
  canCreateArea,
  onCreateArea,
  onSettings,
  onTeams,
  onMenu,
  labels,
}: Props) {
  return (
    <nav className="field-action-bar" aria-label={labels.menu}>
      <div className="field-action-secondary">
        <IconButton label={labels.settings} onClick={onSettings}><GearIcon /></IconButton>
        <IconButton label={labels.teams} onClick={onTeams}><TeamsIcon /></IconButton>
        <IconButton label={labels.menu} onClick={onMenu}><MenuIcon /></IconButton>
      </div>
      {canCreateArea && onCreateArea ? (
        <button className="field-primary-action" type="button" onClick={onCreateArea}>
          {labels.createArea}
        </button>
      ) : null}
    </nav>
  );
}
