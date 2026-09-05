import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccessLinkOnboardingGate } from "./access/AccessLinkOnboardingGate";
import { AccessRecoveryGate } from "./access/AccessRecoveryGate";
import { FieldGroupJoinGate } from "./access/FieldGroupJoinGate";
import { campaignIdFromUrl } from "./data/campaignApi";
import { MapDiagnostics } from "./diagnostics/MapDiagnostics";
import { OrganizationAdminNavEnhancer } from "./organization/OrganizationAdminNavEnhancer";
import { OrganizationApp } from "./organization/OrganizationApp";
import { OrganizationInviteCenter } from "./organization/OrganizationInviteCenter";
import { OrganizationInviteRedeemPage, OrganizationPasswordResetPage } from "./organization/OrganizationPublicLinks";
import { OrganizationSecurityCenter } from "./organization/OrganizationSecurityCenter";
import { isOrganizationAdminPath } from "./organization/organizationRoutes";
import { PlatformShell } from "./platform/PlatformShell";
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
} else if (window.location.pathname === "/join") {
  document.title = "Einladung | Flyer Map";
  root.render(<StrictMode><OrganizationInviteRedeemPage /></StrictMode>);
} else if (window.location.pathname === "/reset") {
  document.title = "Passwort-Reset | Flyer Map";
  root.render(<StrictMode><OrganizationPasswordResetPage /></StrictMode>);
} else if (window.location.pathname === "/admin/invites") {
  document.title = "Einladungen | Flyer Map";
  root.render(<StrictMode><OrganizationInviteCenter /></StrictMode>);
} else if (window.location.pathname === "/admin/security") {
  document.title = "Sicherheit | Flyer Map";
  root.render(<StrictMode><><OrganizationSecurityCenter /><OrganizationAdminNavEnhancer /></></StrictMode>);
} else if (isOrganizationAdminPath(window.location.pathname)) {
  document.title = "Organizer Admin | Flyer Map";
  root.render(<StrictMode><><OrganizationApp /><OrganizationAdminNavEnhancer /></></StrictMode>);
} else if (!campaignIdFromUrl()) {
  document.title = "Anmeldung | Flyer Map";
  window.location.replace("/login");
} else {
  document.title = "Verteil-Flyer";
  root.render(
    <StrictMode>
      <PlatformShell />
      <AccessRecoveryGate />
      <AccessLinkOnboardingGate />
      <FieldGroupJoinGate />
      <MapDiagnostics />
      <SyncStatus />
    </StrictMode>,
  );
}
