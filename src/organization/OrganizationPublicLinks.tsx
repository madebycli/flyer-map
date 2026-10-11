import { useState, type FormEvent } from "react";
import { redeemOrganizationInvite, redeemOrganizationPasswordReset } from "./organizationApiClient.ts";
import { TotpEnrollment, consumeFragmentToken, errorMessage } from "./shared.tsx";
import { Button, Card, CenterPage, Field, LinkButton, Notice, TextInput } from "../ui/index.ts";

/** Two new passwords that must match; both fields enforce the length the server expects. */
function PasswordPair({ password, again, onPassword, onAgain, label = "Passwort" }: { password: string; again: string; onPassword: (v: string) => void; onAgain: (v: string) => void; label?: string }) {
  return (
    <>
      <Field label={label}><TextInput type="password" value={password} onChange={(event) => onPassword(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></Field>
      <Field label="Passwort wiederholen"><TextInput type="password" value={again} onChange={(event) => onAgain(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></Field>
    </>
  );
}

export function OrganizationInviteRedeemPage() {
  const [token] = useState(consumeFragmentToken);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [enrollment, setEnrollment] = useState<{ otpauthUri: string; recoveryCodes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "Einladungs-Token fehlt oder wurde bereits aus der URL entfernt.");

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    if (password !== passwordAgain) { setError("Die Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await redeemOrganizationInvite({ inviteSecret: token, username, password });
      setEnrollment({ otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes });
      setPassword("");
      setPasswordAgain("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (enrollment) {
    return (
      <CenterPage>
        <TotpEnrollment
          enrollment={enrollment}
          title="MFA jetzt einrichten"
          intro="QR-Code mit der Authenticator-App scannen."
          confirmLabel="MFA bestätigen & Admin öffnen"
          onConfirmed={() => window.location.replace("/admin")}
        />
      </CenterPage>
    );
  }

  return (
    <CenterPage>
      <Card eyebrow="Organisation-Einladung" title="Admin-Account sicher einrichten" icon="users">
        <form className="ui-form" onSubmit={(event) => void redeem(event)}>
          <Field label="Benutzername"><TextInput value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={40} autoComplete="username" required /></Field>
          <PasswordPair password={password} again={passwordAgain} onPassword={setPassword} onAgain={setPasswordAgain} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button tone="primary" busy={busy} disabled={!token}>{busy ? "Einladung wird eingelöst …" : "Account anlegen"}</Button>
        </form>
      </Card>
    </CenterPage>
  );
}

export function OrganizationPasswordResetPage() {
  const [token] = useState(consumeFragmentToken);
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "Reset-Token fehlt oder wurde bereits aus der URL entfernt.");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    if (password !== passwordAgain) { setError("Die Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    setError(null);
    try {
      await redeemOrganizationPasswordReset(token, password);
      setPassword("");
      setPasswordAgain("");
      setDone(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <CenterPage>
        <Card eyebrow="Passwort geändert" title="Alle alten Sitzungen wurden widerrufen" icon="check">
          <p>Passwort geändert. Bitte neu anmelden.</p>
          <LinkButton tone="primary" href="/login">Zum Login</LinkButton>
        </Card>
      </CenterPage>
    );
  }

  return (
    <CenterPage>
      <Card eyebrow="Sicherer Passwort-Reset" title="Neues Passwort setzen" icon="lock">
        <form className="ui-form" onSubmit={(event) => void submit(event)}>
          <PasswordPair label="Neues Passwort" password={password} again={passwordAgain} onPassword={setPassword} onAgain={setPasswordAgain} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button tone="primary" busy={busy} disabled={!token}>{busy ? "Passwort wird ersetzt …" : "Passwort sicher ersetzen"}</Button>
        </form>
      </Card>
    </CenterPage>
  );
}
