import type { TaskStatus } from "../domain/campaign.ts";
import type { NetworkRoute, RoadSnap } from "../domain/streetNetwork.ts";
import { FieldHub } from "../platform/FieldHub.tsx";

type PendingNetworkIntent = {
  key: string;
  blocked: boolean;
};

export type NetworkWorkspacePanelState = {
  message: string;
  choices: RoadSnap[];
  routes: NetworkRoute[];
  selected: number | null;
  activeRoute: NetworkRoute | null;
  pending: PendingNetworkIntent[];
  onChoice: (choice: RoadSnap) => void;
  onRouteSelect: (index: number) => void;
  onCommit: (status: TaskStatus) => void | Promise<void>;
  onReset: () => void;
  onClose: () => void;
  onDiscard: (key: string) => void | Promise<void>;
};

export function NetworkWorkspacePanel({ state }: { state: NetworkWorkspacePanelState }) {
  return (
    <FieldHub
      open
      title="Straßenabschnitt markieren"
      kicker="Karte"
      onClose={state.onClose}
      initialSnap="expanded"
      className="map-context-hub map-network-hub"
    >
      <div className="map-context-content">
        <p role="status">{state.message}</p>
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
        <div className="mode-actions">
          <button className="button secondary" onClick={state.onReset}>
            A/B neu wählen
          </button>
          <button className="button secondary" onClick={state.onClose}>
            Schließen
          </button>
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
