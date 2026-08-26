import type { ActionMode, ActionTemplateBlueprint } from "./actionTemplate.ts";

export type NewActionSetupDraft = {
  actionName: string;
  mode: ActionMode;
  templateName: string | null;
  cycleLabel: string | null;
};

export function buildNewActionSetupDraft(input: {
  actionName: string;
  mode: ActionMode;
  template: ActionTemplateBlueprint | null;
  cycleLabel?: string | null;
}): NewActionSetupDraft {
  const actionName = input.actionName.trim();
  if (!actionName || actionName.length > 160) throw new Error("invalid_action_name");

  const cycleLabel = input.cycleLabel?.trim() || null;
  if (cycleLabel && cycleLabel.length > 160) throw new Error("invalid_cycle_label");

  if (input.template && input.template.mode !== input.mode) {
    throw new Error("template_mode_mismatch");
  }

  return {
    actionName,
    mode: input.mode,
    templateName: input.template?.name ?? null,
    cycleLabel,
  };
}

export function compatibleActionTemplates(
  templates: ActionTemplateBlueprint[],
  mode: ActionMode,
) {
  return templates.filter((template) => template.mode === mode);
}
