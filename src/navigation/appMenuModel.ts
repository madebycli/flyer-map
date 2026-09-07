import type { AccessInfo } from "../data/campaignApi.ts";

export type AppMenuModuleId =
  | "progress"
  | "teams"
  | "activity"
  | "collection"
  | "support"
  | "settings"
  | "admin";

export type AppMenuModuleState = "available" | "planned";

export type AppMenuModule = {
  id: AppMenuModuleId;
  state: AppMenuModuleState;
  requiresAdmin: boolean;
};

const BASE_MODULES: readonly AppMenuModule[] = [
  { id: "progress", state: "available", requiresAdmin: false },
  { id: "teams", state: "available", requiresAdmin: false },
  { id: "activity", state: "planned", requiresAdmin: false },
  { id: "collection", state: "planned", requiresAdmin: false },
  { id: "support", state: "available", requiresAdmin: false },
  { id: "settings", state: "available", requiresAdmin: false },
  { id: "admin", state: "planned", requiresAdmin: true },
] as const;

export function appMenuModules(access: AccessInfo | null): AppMenuModule[] {
  return BASE_MODULES.filter((module) => !module.requiresAdmin || access?.role === "admin").map(
    (module) => ({ ...module }),
  );
}

export function availableAppMenuModules(access: AccessInfo | null) {
  return appMenuModules(access).filter((module) => module.state === "available");
}
