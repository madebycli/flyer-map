import type { PlatformAppContext } from "../platform/platformContract.ts";
import { FieldHub, FieldHubEmpty } from "../platform/FieldHub.tsx";
import { TeamCommentsSummary } from "../team/TeamCommentsSummary.tsx";

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
    <FieldHub open title="Kommentare" kicker="Campaign & Team" onClose={onClose} initialSnap="expanded">
      {context ? <TeamCommentsSummary context={context} online={online} onChanged={onChanged} /> : <FieldHubEmpty>Für Kommentare ist ein gültiger Zugriff nötig.</FieldHubEmpty>}
    </FieldHub>
  );
}
