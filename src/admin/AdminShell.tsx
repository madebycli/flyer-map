import type { ReactNode } from "react";
import {
  ADMIN_SHELL_MODULES,
  type AdminModuleId,
} from "./adminShellModel.ts";
import "./admin-shell.css";

type Props = {
  authorized: boolean;
  activeModule: AdminModuleId;
  onModuleChange: (moduleId: AdminModuleId) => void;
  workspaceLabel: string;
  campaignLabel: string;
  children: ReactNode;
  labels: Record<AdminModuleId, string> & {
    title: string;
    unauthorized: string;
    planned: string;
    fieldMap: string;
  };
  onOpenFieldMap?: () => void;
};

export function AdminShell({
  authorized,
  activeModule,
  onModuleChange,
  workspaceLabel,
  campaignLabel,
  children,
  labels,
  onOpenFieldMap,
}: Props) {
  if (!authorized) {
    return (
      <section className="admin-shell-denied" role="alert">
        <strong>{labels.title}</strong>
        <p>{labels.unauthorized}</p>
      </section>
    );
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar" aria-label={labels.title}>
        <header>
          <span>{workspaceLabel}</span>
          <strong>{labels.title}</strong>
          <small>{campaignLabel}</small>
        </header>

        <nav className="admin-navigation">
          {ADMIN_SHELL_MODULES.map((module) => {
            const active = module.id === activeModule;
            return (
              <button
                type="button"
                key={module.id}
                className={active ? "is-active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => onModuleChange(module.id)}
              >
                <span>{labels[module.id]}</span>
                {module.state === "planned" ? <small>{labels.planned}</small> : null}
              </button>
            );
          })}
        </nav>

        {onOpenFieldMap ? (
          <button className="admin-field-link" type="button" onClick={onOpenFieldMap}>
            {labels.fieldMap}
          </button>
        ) : null}
      </aside>

      <section className="admin-workspace">
        <header className="admin-workspace-header">
          <span>{campaignLabel}</span>
          <strong>{labels[activeModule]}</strong>
        </header>
        <div className="admin-workspace-content">{children}</div>
      </section>
    </main>
  );
}
