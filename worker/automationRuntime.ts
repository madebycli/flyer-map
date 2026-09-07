import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  COMPLETE_PARENT_STREET_EFFECT_TYPE,
  COMPLETE_PARENT_STREET_RULE_TYPE,
  type AutomationRuleType,
} from "../src/domain/automations.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import { isAutomationEnabled } from "./automationConfig.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";

export type AutomationExecution = {
  ruleType: AutomationRuleType;
  ruleVersion: 1;
  effectType: typeof COMPLETE_PARENT_STREET_EFFECT_TYPE;
  parentStreetTaskId: string;
  parentTeamId: string;
  triggerHouseTaskId: string;
  fieldSessionId: string | null;
};

export async function buildAutomationExecution(
  db: D1DatabaseLike,
  current: CampaignSnapshot,
  candidate: CampaignSnapshot,
  mutation: CampaignMutation,
  fieldSessionId: string | null,
): Promise<AutomationExecution | null> {
  if (mutation.type !== "house.set-status" || mutation.payload.status !== "completed") {
    return null;
  }

  const currentHouse = current.houseTasks?.find((task) => task.id === mutation.payload.taskId);
  if (
    !currentHouse ||
    currentHouse.status === "completed" ||
    !currentHouse.parentStreetTaskId ||
    currentHouse.campaignId !== current.campaign.id
  ) {
    return null;
  }

  const parent = current.tasks.find((task) => task.id === currentHouse.parentStreetTaskId);
  const houseArea = current.areas.find((area) => area.id === currentHouse.areaId);
  const parentArea = parent ? current.areas.find((area) => area.id === parent.areaId) : null;
  if (
    !parent ||
    !houseArea ||
    !parentArea ||
    parent.campaignId !== current.campaign.id ||
    parent.areaId !== currentHouse.areaId ||
    parentArea.id !== houseArea.id ||
    parentArea.teamId !== houseArea.teamId ||
    parent.status !== "open"
  ) {
    return null;
  }

  const candidateParent = candidate.tasks.find((task) => task.id === parent.id);
  const children = (candidate.houseTasks ?? []).filter(
    (task) =>
      task.campaignId === candidate.campaign.id &&
      task.areaId === parent.areaId &&
      task.parentStreetTaskId === parent.id,
  );
  if (
    !candidateParent ||
    candidateParent.status !== "open" ||
    children.length === 0 ||
    children.some((task) => task.status !== "completed")
  ) {
    return null;
  }

  if (!(await isAutomationEnabled(db, current.campaign.id, COMPLETE_PARENT_STREET_RULE_TYPE))) {
    return null;
  }

  return {
    ruleType: COMPLETE_PARENT_STREET_RULE_TYPE,
    ruleVersion: 1,
    effectType: COMPLETE_PARENT_STREET_EFFECT_TYPE,
    parentStreetTaskId: parent.id,
    parentTeamId: parentArea.teamId,
    triggerHouseTaskId: currentHouse.id,
    fieldSessionId,
  };
}
