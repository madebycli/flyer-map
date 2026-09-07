import type { AdminAnalyticsExportPackage } from "../domain/adminAnalyticsExport.ts";
import "./admin-analytics-export.css";

const EXPORT_FILES = [
  "analytics.json",
  "teams.csv",
  "areas.csv",
  "sessions.csv",
  "events.csv",
  "AI_ANALYSE_PROMPT.md",
] as const;

type Props = {
  authorized: boolean;
  actionLabel: string;
  onPrepareExport: () => Promise<AdminAnalyticsExportPackage> | AdminAnalyticsExportPackage;
  onExportReady: (pkg: AdminAnalyticsExportPackage) => void;
};

export function AdminAnalyticsExportPanel({
  authorized,
  actionLabel,
  onPrepareExport,
  onExportReady,
}: Props) {
  const prepare = async () => {
    if (!authorized) return;
    const pkg = await onPrepareExport();
    onExportReady(pkg);
  };

  return (
    <section className="admin-analytics-export" aria-labelledby="admin-analytics-export-title">
      <div>
        <span>Admin</span>
        <h2 id="admin-analytics-export-title">Analysepaket exportieren</h2>
        <p>
          Erstellt strukturierte Aktionsdaten plus einen fertigen AI-Analyse-Prompt für {actionLabel}.
        </p>
      </div>

      <ul aria-label="Enthaltene Exportdateien">
        {EXPORT_FILES.map((fileName) => <li key={fileName}>{fileName}</li>)}
      </ul>

      <div className="admin-analytics-export__privacy">
        <strong>Nicht enthalten</strong>
        <p>
          Passwörter, TOTP, Zugangstokens, QR-/Room-Code-Geheimnisse, GPS-Routen,
          Kommentartexte und freie Session-Notizen werden nicht in das AI-Paket übernommen.
        </p>
      </div>

      <button type="button" onClick={prepare} disabled={!authorized}>
        {authorized ? "Analysepaket vorbereiten" : "Nur für berechtigte Admins"}
      </button>
    </section>
  );
}
