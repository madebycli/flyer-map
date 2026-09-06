
import type { PlatformAppContext } from "../platform/platformContract.ts";
import { FieldBottomSheet } from "../platform/FieldBottomSheet.tsx";
import { TeamCommentsSummary } from "../team/TeamCommentsSummary.tsx";
import "../team/team-center.css";

export function CommentsHub({
  context,
  online,
  onClose,
  onChanged,
}: {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <FieldBottomSheet open title="Kommentare" kicker="Campaign & Team" onClose={onClose} initialSnap="expanded">
      {context ? <TeamCommentsSummary context={context} online={online} onChanged={onChanged} /> : <div className="team-center-empty">Für Kommentare ist ein gültiger Zugriff nötig.</div>}
    </FieldBottomSheet>
  );
}
