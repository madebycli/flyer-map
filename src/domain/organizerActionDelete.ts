export const ACTION_DELETE_CONFIRMATION = "AKTION LÖSCHEN" as const;

export type ActionDeleteCandidate = {
  actionId: string;
  actionName: string;
  status: "draft" | "active" | "archived";
};

export type ActionDeleteReadiness =
  | { ready: true }
  | { ready: false; reason: "not-organizer" | "invalid-action" | "confirmation-mismatch" };

function validAction(candidate: ActionDeleteCandidate) {
  return (
    /^campaign_[A-Za-z0-9_-]{6,160}$/u.test(candidate.actionId) &&
    candidate.actionName.trim().length > 0 &&
    candidate.actionName.length <= 200
  );
}

/**
 * Client-side UX guard only. The Worker must still re-authenticate/authorize the
 * Organizer and perform the real destructive operation server-side.
 */
export function actionDeleteReadiness(
  candidate: ActionDeleteCandidate,
  isOrganizer: boolean,
  confirmationText: string,
): ActionDeleteReadiness {
  if (!isOrganizer) return { ready: false, reason: "not-organizer" };
  if (!validAction(candidate)) return { ready: false, reason: "invalid-action" };
  if (confirmationText !== ACTION_DELETE_CONFIRMATION) {
    return { ready: false, reason: "confirmation-mismatch" };
  }
  return { ready: true };
}
