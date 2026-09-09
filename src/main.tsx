import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AccessLinkOnboardingGate } from "./access/AccessLinkOnboardingGate";
import { AccessRecoveryGate } from "./access/AccessRecoveryGate";
import { FieldGroupJoinGate } from "./access/FieldGroupJoinGate";
import { campaignIdFromUrl } from "./data/campaignApi";
import { installRxdbFetchGuard } from "./data/rxdbFetchGuard";
import { isOrganizationAdminPath } from "./organization/organizationRoutes";
import { SyncStatus } from "./sync/SyncStatus";
import "./styles.css";
import "./street-mode.css";
import "./mobile-stability.css";
import "./svg-overlay.css";
import "./m4.css";
import "./m5.css";
import "./access-recovery.css";
import "./diagnostics/map-diagnostics.css";
import "./map-context-ui.css";

const MapDiagnostics = lazy(() => import("./diagnostics/MapDiagnostics").then(module => ({ default: module.MapDiagnostics })));
const OrganizationAdminNavEnhancer = lazy(() => import("./organization/OrganizationAdminNavEnhancer").then(module => ({ default: module.OrganizationAdminNavEnhancer })));
const OrganizationApp = lazy(() => import("./organization/OrganizationApp").then(module => ({ default: module.OrganizationApp })));
const OrganizationInviteCenter = lazy(() => import("./organization/OrganizationInviteCenter").then(module => ({ default: module.OrganizationInviteCenter })));
const OrganizationInviteRedeemPage = lazy(() => import("./organization/OrganizationPublicLinks").then(module => ({ default: module.OrganizationInviteRedeemPage })));
const OrganizationPasswordResetPage = lazy(() => import("./organization/OrganizationPublicLinks").then(module => ({ default: module.OrganizationPasswordResetPage })));
const OrganizationSecurityCenter = lazy(() => import("./organization/OrganizationSecurityCenter").then(module => ({ default: module.OrganizationSecurityCenter })));
const FunnyFocusVideo = lazy(() => import("./platform/FunnyFocusVideo").then(module => ({ default: module.FunnyFocusVideo })));
const PlatformShell = lazy(() => import("./platform/PlatformShell").then(module => ({ default: module.PlatformShell })));
const ActionWorkbenchPreview = lazy(() => import("./workbench/ActionWorkbenchPreview").then(module => ({ default: module.ActionWorkbenchPreview })));
const AdminWorkbenchPreview = lazy(() => import("./workbench/AdminWorkbenchPreview").then(module => ({ default: module.AdminWorkbenchPreview })));
const LiveGroupWorkbenchPreview = lazy(() => import("./workbench/LiveGroupWorkbenchPreview").then(module => ({ default: module.LiveGroupWorkbenchPreview })));
const M6SelectionPreview = lazy(() => import("./workbench/M6SelectionPreview").then(module => ({ default: module.M6SelectionPreview })));
const WorkbenchPreview = lazy(() => import("./workbench/WorkbenchPreview").then(module => ({ default: module.WorkbenchPreview })));

installRxdbFetchGuard();

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
  root.render(<StrictMode><Suspense fallback={<div role="status" className="app-loading">Lade …</div>}>{preview.component}</Suspense></StrictMode>);
} else if (window.location.pathname === "/join") {
  document.title = "Einladung | Flyer Map";
  root.render(<StrictMode><Suspense fallback={<div role="status" className="app-loading">Lade …</div>}><OrganizationInviteRedeemPage /></Suspense></StrictMode>);
} else if (window.location.pathname === "/reset") {
  document.title = "Passwort-Reset | Flyer Map";
  root.render(<StrictMode><Suspense fallback={<div role="status" className="app-loading">Lade …</div>}><OrganizationPasswordResetPage /></Suspense></StrictMode>);
} else if (window.location.pathname === "/admin/invites") {
  document.title = "Einladungen | Flyer Map";
  root.render(<StrictMode><Suspense fallback={<div role="status" className="app-loading">Lade …</div>}><OrganizationInviteCenter /></Suspense></StrictMode>);
} else if (window.location.pathname === "/admin/security") {
  document.title = "Sicherheit | Flyer Map";
  root.render(<StrictMode><Suspense fallback={<div role="status" className="app-loading">Lade …</div>}><><OrganizationSecurityCenter /><OrganizationAdminNavEnhancer /></></Suspense></StrictMode>);
} else if (isOrganizationAdminPath(window.location.pathname)) {
  document.title = "Organizer Admin | Flyer Map";
  root.render(<StrictMode><Suspense fallback={<div role="status" className="app-loading">Lade …</div>}><><OrganizationApp /><OrganizationAdminNavEnhancer /></></Suspense></StrictMode>);
} else if (!campaignIdFromUrl()) {
  document.title = "Anmeldung | Flyer Map";
  window.location.replace("/login");
} else {
  document.title = "Verteil-Flyer";
  root.render(
    <StrictMode><Suspense fallback={<div role="status" className="app-loading">Lade …</div>}>
      <PlatformShell />
      <FunnyFocusVideo />
      <AccessRecoveryGate />
      <AccessLinkOnboardingGate />
      <FieldGroupJoinGate />
      <MapDiagnostics />
      <SyncStatus />
    </Suspense></StrictMode>,
  );
}
