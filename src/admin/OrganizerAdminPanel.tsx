export type AdminAccountListItem = {
  id: string;
  username: string;
  role: "organizer" | "admin";
  status: "active" | "disabled";
};

type Props = {
  accounts: AdminAccountListItem[];
  canManageAdmins: boolean;
  canManageOrganizers: boolean;
  onAddAdmin: () => void;
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
            Organisatoren verwalten die administrative Ebene. Normale Admins bearbeiten den Betrieb
            nur innerhalb ihrer serverseitig zugewiesenen Rechte.
          </p>
        </div>
        <button type="button" onClick={onAddAdmin} disabled={!canManageAdmins}>
          Admin hinzufügen
        </button>
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
        Diese Oberfläche erzeugt keine Rechte. Hinzufügen, Rollenwechsel und Deaktivierung müssen
        später immer durch den Worker autorisiert, erneut geprüft und auditiert werden.
      </p>
    </section>
  );
}
