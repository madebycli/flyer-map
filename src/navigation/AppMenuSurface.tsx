import type { AppMenuModule, AppMenuModuleId } from "./appMenuModel.ts";
import "./app-menu.css";

export type AppMenuLabels = Record<AppMenuModuleId, string> & {
  title: string;
  close: string;
  planned: string;
};

type Props = {
  modules: AppMenuModule[];
  labels: AppMenuLabels;
  onSelect: (moduleId: AppMenuModuleId) => void;
  onClose: () => void;
};

export function AppMenuSurface({ modules, labels, onSelect, onClose }: Props) {
  return (
    <section
      className="app-menu-surface"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-menu-title"
    >
      <header className="app-menu-header">
        <h2 id="app-menu-title">{labels.title}</h2>
        <button
          className="app-menu-close"
          type="button"
          onClick={onClose}
          aria-label={labels.close}
          title={labels.close}
        >
          ×
        </button>
      </header>

      <div className="app-menu-grid">
        {modules.map((module) => {
          const planned = module.state === "planned";
          return (
            <button
              className="app-menu-item"
              type="button"
              key={module.id}
              onClick={() => onSelect(module.id)}
              disabled={planned}
              aria-disabled={planned}
            >
              <span className="app-menu-item-title">{labels[module.id]}</span>
              {planned ? <span className="app-menu-item-state">{labels.planned}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
