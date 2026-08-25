import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AccessRecoveryGate } from "./access/AccessRecoveryGate";
import { MapDiagnostics } from "./diagnostics/MapDiagnostics";
import { SyncStatus } from "./sync/SyncStatus";
import { WorkbenchPreview } from "./workbench/WorkbenchPreview";
import "./styles.css";
import "./street-mode.css";
import "./mobile-stability.css";
import "./svg-overlay.css";
import "./m4.css";
import "./m5.css";
import "./access-recovery.css";
import "./diagnostics/map-diagnostics.css";

const workbenchMode = new URLSearchParams(window.location.search).get("workbench");
const root = createRoot(document.getElementById("root")!);

if (workbenchMode === "ui") {
  root.render(
    <StrictMode>
      <WorkbenchPreview />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
      <AccessRecoveryGate />
      <MapDiagnostics />
      <SyncStatus />
    </StrictMode>,
  );
}
