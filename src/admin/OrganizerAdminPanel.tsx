export type AdminAccountListItem = {
  id: string;
  username: string;
  role: "organizer" | "admin";
  status: "active" | "disabled";
  adminManagementDelegated?: boolean;
};

type Props = {
  accounts: AdminAccountListItem[];
  canManageAdmins: boolean;
  canManageOrganizers: boolean;
  onAddAdmin: () => void;
  onAddOrganizer?: () => void;
  onManageAccount: (account: AdminAccountListItem) => void;
};

function roleLabel(role: AdminAccountListItem["role"]) {
  return role === "organizer" ? "Organisator" : "Admin";
}

export function OrganizerAdminPanel({
  accounts,
  canManageAdmins,
  canManageOrganizers,
  onAddAdmin,
  onAddOrganizer,
  onManageAccount,
}: Props) {
  const activeOrganizers = accounts.filter(
    (account) => account.role === "organizer" && account.status === "active",
  ).length;

  return (
    <section className="organizer-admin-panel" aria-labelledby="organizer-admin-title">
      <header>
        <div>
          <span>Organisation</span>
          <h2 id="organizer-admin-title">Organisatoren & Admins</h2>
          <p>
            Mehrere Organisatoren sind erlaubt. Mindestens ein wirksamer Organisator muss immer
            erhalten bleiben. Admin-Verwaltung kann ausgewählten Admins explizit delegiert werden.
          </p>
        </div>
        <div className="organizer-admin-panel__create-actions">
          <button type="button" onClick={onAddAdmin} disabled={!canManageAdmins}>
            Admin hinzufügen
          </button>
          {onAddOrganizer ? (
            <button type="button" onClick={onAddOrganizer} disabled={!canManageOrganizers}>
              Organisator hinzufügen
            </button>
          ) : null}
        </div>
      </header>

      <div className="organizer-admin-panel__safety">
        <strong>{activeOrganizers} aktive Organisator{activeOrganizers === 1 ? "" : "en"}</strong>
        <span>Die Oberfläche darf den letzten wirksamen Organisator niemals selbst entfernen.</span>
      </div>

      <ul>
        {accounts.map((account) => {
          const manageable = account.role === "admin" ? canManageAdmins : canManageOrganizers;
          return (
            <li key={account.id}>
              <div>
                <strong>{account.username}</strong>
                <span>
                  {roleLabel(account.role)} · {account.status === "active" ? "Aktiv" : "Deaktiviert"}
                </span>
                {account.role === "admin" && account.adminManagementDelegated ? (
                  <span>Admin-Verwaltung delegiert</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onManageAccount(account)}
                disabled={!manageable}
                aria-label={`${account.username} verwalten`}
              >
                Verwalten
              </button>
            </li>
          );
        })}
      </ul>

      <p className="organizer-admin-panel__note">
        Diese Oberfläche erzeugt keine Rechte. Hinzufügen, Rollenwechsel, Delegation und
        Deaktivierung müssen später immer durch den Worker autorisiert, erneut geprüft und auditiert werden.
      </p>
    </section>
  );
}
