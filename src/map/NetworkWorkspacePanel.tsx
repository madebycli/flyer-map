import type { TaskStatus } from "../domain/campaign.ts";
import type { NetworkRoute, RoadSnap } from "../domain/streetNetwork.ts";
import { FieldHub } from "../platform/FieldHub.tsx";

type PendingNetworkIntent = {
  key: string;
  blocked: boolean;
};

export type NetworkWorkspacePanelState = {
  title: string;
  message: string;
  choices: RoadSnap[];
  routes: NetworkRoute[];
  selected: number | null;
  activeRoute: NetworkRoute | null;
  pointCount: number;
  maxPoints: number;
  saving: boolean;
  pending: PendingNetworkIntent[];
  onChoice: (choice: RoadSnap) => void;
  onRouteSelect: (index: number) => void;
  onCommit: (status: TaskStatus) => void | Promise<void>;
  onReset: () => void;
  onUndo: () => void;
  onClose: () => void;
  onDiscard: (key: string) => void | Promise<void>;
};

export function NetworkWorkspacePanel({ state }: { state: NetworkWorkspacePanelState }) {
  return (
    <FieldHub
      open
      title={state.title}
      kicker="Street Mode"
      headerAside={<span>{state.pointCount}/{state.maxPoints} Punkte</span>}
      headerActions={({ reveal }) => (
        <>
          <button className="field-sheet-header-action" type="button" onClick={state.onUndo} disabled={state.saving||!state.pointCount} aria-label="Letzten Punkt rückgängig machen">↶</button>
          <button className="field-sheet-header-action" type="button" onClick={state.onClose} disabled={state.saving} aria-label="Markierung abbrechen">×</button>
          <button className="field-sheet-header-action field-sheet-header-action-confirm" type="button" disabled={!state.activeRoute} onClick={reveal} aria-label="Statusauswahl öffnen">✓</button>
        </>
      )}
      showClose={false}
      onClose={state.onClose}
      initialSnap="compact"
      retractable
      initialRetracted
      overlayClassName="map-context-overlay map-interaction-overlay"
      className="map-context-hub map-network-hub"
    >
      <div className="map-context-content">
        <p role="status">{state.message}</p>
        {state.pointCount>0?<button className="button secondary" disabled={state.saving} onClick={state.onReset}>Punktfolge verwerfen</button>:null}
        {state.choices.map((choice) => (
          <button className="button secondary" key={choice.task.id} onClick={() => state.onChoice(choice)}>
            {choice.task.label}
          </button>
        ))}
        {state.routes.length > 1 ? (
          <div className="mode-actions">
            {state.routes.map((route, index) => (
              <button
                className={"button " + (state.selected === index ? "primary" : "secondary")}
                key={index}
                onClick={() => state.onRouteSelect(index)}
              >
                Route {index + 1} · {route.ranges.length} Abschnitte
              </button>
            ))}
          </div>
        ) : null}
        <div className="mode-actions">
          {(["completed", "later", "not-deliverable", "open"] as const).map((status, index) => (
            <button
              className="button secondary"
              key={status}
              disabled={!state.activeRoute}
              onClick={() => void state.onCommit(status)}
            >
              {["Erledigt", "Später", "Nicht zustellbar", "Wieder öffnen"][index]}
            </button>
          ))}
        </div>
        {state.pending.map((item) => (
          <p key={item.key}>
            {item.blocked ? "Änderung braucht eine neue Auswahl." : "Änderung vorgemerkt."}{" "}
            <button onClick={() => void state.onDiscard(item.key)}>Verwerfen</button>
          </p>
        ))}
      </div>
    </FieldHub>
  );
}
