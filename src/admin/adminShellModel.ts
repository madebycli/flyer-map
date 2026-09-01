export type AdminModuleId =
  | "campaigns"
  | "teams"
  | "areas"
  | "access"
  | "progress"
  | "collaboration"
  | "support"
  | "security";

export type AdminModuleState = "available" | "planned";

export type AdminModule = {
  id: AdminModuleId;
  state: AdminModuleState;
};

export const ADMIN_SHELL_MODULES: readonly AdminModule[] = [
  { id: "campaigns", state: "planned" },
  { id: "teams", state: "available" },
  { id: "areas", state: "available" },
  { id: "access", state: "available" },
  { id: "progress", state: "available" },
  { id: "collaboration", state: "planned" },
  { id: "support", state: "available" },
  { id: "security", state: "planned" },
] as const;

export function adminModuleById(moduleId: AdminModuleId) {
  return ADMIN_SHELL_MODULES.find((module) => module.id === moduleId) ?? null;
}
