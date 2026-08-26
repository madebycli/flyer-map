import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AccessRecoveryGate } from "./access/AccessRecoveryGate";
import { MapDiagnostics } from "./diagnostics/MapDiagnostics";
import { SyncStatus } from "./sync/SyncStatus";
import { ActionWorkbenchPreview } from "./workbench/ActionWorkbenchPreview";
import { AdminWorkbenchPreview } from "./workbench/AdminWorkbenchPreview";
import { LiveGroupWorkbenchPreview } from "./workbench/LiveGroupWorkbenchPreview";
import { M6SelectionPreview } from "./workbench/M6SelectionPreview";
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

const previews = {
  ui: { title: "UI Workbench | Flyer Map", component: <WorkbenchPreview /> },
  m6: { title: "Smart Streets Workbench | Flyer Map", component: <M6SelectionPreview /> },
  admin: { title: "Admin Workbench | Flyer Map", component: <AdminWorkbenchPreview /> },
  groups: { title: "Live Groups Workbench | Flyer Map", component: <LiveGroupWorkbenchPreview /> },
  actions: { title: "Actions Workbench | Flyer Map", component: <ActionWorkbenchPreview /> },
} as const;

const preview = workbenchMode && workbenchMode in previews
  ? previews[workbenchMode as keyof typeof previews]
  : null;

if (preview) {
  document.title = preview.title;
  root.render(<StrictMode>{preview.component}</StrictMode>);
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
