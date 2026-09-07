export const COMPLETE_PARENT_STREET_RULE_TYPE =
  "complete-parent-street-when-all-houses-complete" as const;

export const COMPLETE_PARENT_STREET_EFFECT_TYPE = "complete-parent-street" as const;

export const AUTOMATION_RULE_TYPES = [COMPLETE_PARENT_STREET_RULE_TYPE] as const;
export type AutomationRuleType = (typeof AUTOMATION_RULE_TYPES)[number];

export type AutomationRuleDefinition = {
  ruleType: AutomationRuleType;
  version: 1;
  label: string;
  description: string;
  caution: string;
};

export const AUTOMATION_REGISTRY: readonly AutomationRuleDefinition[] = [
  {
    ruleType: COMPLETE_PARENT_STREET_RULE_TYPE,
    version: 1,
    label: "Straße abschließen, wenn alle Häuser erledigt sind",
    description:
      "Wenn alle gespeicherten Häuser einer Straße erledigt sind, wird eine noch offene Straße automatisch abgeschlossen.",
    caution: "Später oder nicht zustellbar gesetzte Straßen werden nicht überschrieben.",
  },
] as const;

export function automationDefinition(ruleType: string) {
  return AUTOMATION_REGISTRY.find((definition) => definition.ruleType === ruleType) ?? null;
}

export type AutomationRuleState = {
  ruleType: AutomationRuleType;
  version: 1;
  label: string;
  description: string;
  caution: string;
  enabled: boolean;
  updatedAt: string | null;
};
