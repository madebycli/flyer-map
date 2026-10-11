import { useMemo, useState } from 'react';
import { Icon } from '../../ui/index.ts';
import { SheetFrame } from './sheet.tsx';

export type HelpRole = 'admin' | 'team-editor' | 'viewer' | 'collection-collector';
type Entry = { q: string; a: string[]; roles?: HelpRole[]; tags?: string };

/** Short answers, one idea each. `roles` limits who sees an entry: an admin gets no helper-only tips and a helper no admin chapters. */
const ENTRIES: Entry[] = [
  { q: 'Wie markiere ich eine Strecke?', tags: 'strecke straße smart marking', roles: ['admin', 'team-editor'], a: [
    'Tippe auf das grüne Quadrat unten rechts. Tippe dann auf der Karte die Straße an, bei der du anfängst, und danach die Straße, bei der du aufhörst.',
    'Alles dazwischen wird gewählt. Mit dem Haken bestätigst du, danach wählst du den Status. Danach ist der Markier-Modus wieder aus.' ] },
  { q: 'Wie markiere ich einzelne Häuser?', tags: 'haus häuser einzeln', roles: ['admin', 'team-editor'], a: [
    'Im Markier-Modus tippst du die Häuser einfach an, jedes Haus kommt dazu. Ein zweiter Tipp nimmt es wieder heraus. Mit dem Haken bestätigst du und wählst den Status.',
    'Straße und Häuser lassen sich mischen: erst die Strecke, dann noch ein paar Häuser dazu.' ] },
  { q: 'Wie markiere ich viele auf einmal?', tags: 'wischen lasso tippen modus', roles: ['admin', 'team-editor'], a: [
    'Halte das grüne Quadrat gedrückt (oder tippe im Panel auf die Zahl). Dort wählst du „Wischen“ (mit dem Finger über Häuser und Straßen fahren), „Lasso“ (einen Bereich umkreisen) oder „Tippen“ (ein Tipp, ein Haus).',
    'Bei diesen drei Modi gilt sofort der Pinsel, den du dort eingestellt hast.' ] },
  { q: 'Wie bewege ich die Karte bei „Wischen“ und „Lasso“?', tags: 'karte bewegen ziehen zoomen halten finger wischen lasso', roles: ['admin', 'team-editor'], a: [
    'Mit einem Finger über die Karte ziehen bewegt sie, mit zwei Fingern zoomst du, wie sonst auch. Zum Markieren legst du den Finger kurz an (ein Ring zeigt, dass es losgeht) und ziehst dann.',
    'Bei „Tippen“ und „Strecke“ gibt es nichts zu halten: Tippen markiert, Ziehen bewegt die Karte.' ] },
  { q: 'Was bedeuten die Farben?', tags: 'farben status ausgeteilt später nicht möglich offen', a: [
    'Grün: Ausgeteilt, die Flyer sind eingeworfen. Gelb: Später, wird noch einmal angegangen. Rot: Nicht möglich, zum Beispiel kein Zugang oder Briefkasten nicht erreichbar. Grau: Offen, noch nicht bearbeitet.',
    'Der Fortschritt in Prozent zählt Häuser, nicht Straßen. „Nicht möglich“ zählt nicht gegen den Fortschritt.' ] },
  { q: 'Wie mache ich etwas rückgängig?', tags: 'rückgängig zurück undo', roles: ['admin', 'team-editor'], a: [
    'Direkt nach dem Markieren erscheint oben ein Hinweis mit einem Pfeil: ein Tipp darauf nimmt die letzte Markierung zurück.',
    'Im Markier-Modus entfernt „Zurück“ den letzten Punkt. Eine Markierung kannst du jederzeit einfach überschreiben, indem du den Status neu setzt.' ] },
  { q: 'Wie schreibe ich eine Notiz?', tags: 'notiz notizen briefkasten flag', roles: ['admin', 'team-editor'], a: [
    'Tippe ein Haus oder eine Straße an (nicht im Markier-Modus). Im Fenster findest du schnelle Hinweise wie „Briefkasten voll“ zum Antippen und ein Textfeld.',
    'Wo eine Notiz liegt, erscheint ein kleiner Marker auf der Karte. Tippst du ihn an, siehst du alle Notizen dort.' ] },
  { q: 'Wie suche ich eine Straße oder Adresse?', tags: 'suche suchen lupe adresse', a: [
    'Tippe oben rechts auf die Lupe und gib einen Straßennamen oder eine Adresse ein, zum Beispiel „Hauptstr. 12“. Ein Treffer fliegt zur Stelle und öffnet sie.' ] },
  { q: 'Wo sehe ich meinen Fortschritt?', tags: 'fortschritt prozent übersicht', a: [
    'Oben links zeigt die Kapsel den Fortschritt in Prozent. Tippst du darauf, öffnet sich die Übersicht mit den Zahlen je Status und je Gebiet.' ] },
  { q: 'Was heißt „überschrieben“?', tags: 'überschrieben konflikt warnung', roles: ['admin', 'team-editor'], a: [
    'Wenn zwei Personen dieselbe Straße oder dasselbe Haus zur gleichen Zeit unterschiedlich markieren, gilt die neuere Markierung. Du siehst oben ein Warnsymbol mit einer Zahl.',
    'Tippe darauf: dort stehen die betroffenen Stellen. Mit dem Haken stellst du deine Version wieder her, mit „Alle so lassen“ akzeptierst du die neuen.' ] },
  { q: 'Was passiert ohne Internet?', tags: 'offline internet empfang synchronisieren', a: [
    'Die App arbeitet weiter, du kannst markieren und Notizen schreiben. Die Wolke oben links zeigt, ob alles gespeichert ist. Sobald du wieder Empfang hast, gleicht sich alles von selbst ab.',
    'Lade die Seite nicht neu, solange Änderungen noch warten: sie sind auf deinem Gerät gespeichert, aber noch nicht bei den anderen.' ] },
  { q: 'Warum kann ich nichts markieren?', tags: 'nicht markieren ansehen gebiet fremd rechte', a: [
    'Entweder hast du nur einen Ansichts-Zugang (das Augen-Symbol oben links), oder das Gebiet gehört zu einer anderen Gruppe. Ein Admin kann dir einen passenden Link geben.' ] },
  { q: 'Wo bin ich auf der Karte?', tags: 'standort gps position', a: [
    'Tippe rechts auf das Standort-Symbol. Dein Standort bleibt auf deinem Gerät und wird nicht gespeichert oder an andere gesendet.' ] },
  { q: 'Wie ändere ich Aussehen und Hand?', tags: 'hell dunkel linkshand theme', a: [
    'Im Menü (unten links) findest du „Hell/Dunkel“ und „Linkshand“. Linkshand spiegelt die Knöpfe auf die andere Seite.' ] },
  { q: 'Wie lade ich andere ein?', tags: 'einladen link zugang freunde', roles: ['team-editor', 'viewer'], a: [
    'Einladungslinks erstellt eine Admin-Person. Frag sie nach einem Link für deine Gruppe (zum Mitmarkieren) oder nur zum Ansehen.' ] },

  { q: 'Wie lege ich ein Gebiet an?', tags: 'gebiet anlegen neu zeichnen', roles: ['admin'], a: [
    'Menü → Gebiete → Plus. Ziehe die Eckpunkte an die richtigen Stellen, an den Kantenmitten kannst du neue Punkte herausziehen. Gib einen Namen ein, wähle die Gruppe und bestätige mit dem Haken.',
    'Straßen und Häuser werden danach automatisch von OpenStreetMap geladen. Das dauert einen Moment, die Karte bleibt benutzbar. Große Gebiete werden in Teilen geladen, ein Hinweis zeigt den Stand.' ] },
  { q: 'Wie ändere oder lösche ich ein Gebiet?', tags: 'gebiet ändern löschen umbenennen verschieben', roles: ['admin'], a: [
    'Menü → Gebiete, dann das Gebiet antippen. Im Fenster kannst du die Eckpunkte bearbeiten, umbenennen, einer anderen Gruppe zuweisen oder löschen.',
    'Beim Löschen gehen Fortschritt und Notizen des Gebiets für alle Geräte verloren. Das lässt sich nicht rückgängig machen.' ] },
  { q: 'Wie erstelle ich Gruppen und weise Gebiete zu?', tags: 'gruppen teams zuweisen farbe', roles: ['admin'], a: [
    'Menü → Gruppen. Lege Gruppen mit Name und Farbe an. Unter „Gebiete zuweisen“ wählst du für jedes Gebiet die Gruppe. Eine Gruppe darf nur in ihren Gebieten markieren.' ] },
  { q: 'Wie lade ich Helfer ein?', tags: 'einladen link zugang helfer gruppe ansehen', roles: ['admin'], a: [
    'Menü → Zugänge. Dort erstellst du Links: für eine Gruppe (darf in deren Gebieten markieren) oder nur zum Ansehen. Schick den Link per Nachricht, die Person muss nichts installieren.',
    'Jeden Link kannst du dort auch wieder widerrufen. Er funktioniert dann sofort nicht mehr.' ] },
  { q: 'Wo sehe ich, wer was gemacht hat?', tags: 'team aktivität wer', roles: ['admin'], a: [
    'Menü → Team zeigt für jede Person, wie viele Häuser sie heute und in den letzten Tagen ausgeteilt hat und wann zuletzt etwas kam.' ] },
  { q: 'Was heißt „Kartendaten laden“?', tags: 'kartendaten laden openstreetmap pack', roles: ['admin'], a: [
    'Straßen und Häuser kommen aus OpenStreetMap und werden einmal je Gebiet geholt. Das Symbol mit dem Pfeil oben links erscheint, wenn für ein Gebiet noch Daten fehlen.',
    'Wenn die Quelle gerade überlastet ist, steht ein Hinweis da. Dann einfach etwas später nochmal tippen.' ] },
  { q: 'Wie speichere und lade ich eine Vorlage?', tags: 'vorlage template aktion kopieren', roles: ['admin'], a: [
    'Menü → „Als Vorlage“ speichert Gruppen und Gebiete ohne Fortschritt als Datei. Mit „Vorlage laden“ legst du daraus in einer anderen Aktion alles neu an.' ] },
  { q: 'Wie entferne ich veraltete Markierungen?', tags: 'bereinigen veraltet orphan', roles: ['admin'], a: [
    'Wenn du ein Gebiet kleiner machst, bleiben Markierungen außerhalb zunächst bestehen. Tippe das Gebiet an und wähle „Veraltete Einträge bereinigen“.' ] },

  { q: 'Wie übernehme ich ein Teilgebiet?', tags: 'abholen teilgebiet übernehmen helfer', roles: ['collection-collector'], a: [
    'Tippe in der Liste ein freies Teilgebiet an und wähle „Übernehmen“. Danach gehört es dir, bis du es abschließt oder eine Admin-Person es freigibt.' ] },
  { q: 'Was sind Sonder-Marker?', tags: 'abholen sonder marker', roles: ['collection-collector', 'admin'], a: [
    'Orte mit besonderen Hinweisen, zum Beispiel „bitte klingeln“. Tippe auf die Karte, schreibe den Titel und speichere. Er erscheint für alle im Abholgebiet.' ] },
];

const TOPIC: Record<HelpRole, { title: string; intro: string[] }> = {
  admin: { title: 'Hilfe für Admins', intro: [
    'Du richtest die Aktion ein: Gebiete zeichnen, Gruppen anlegen, Gebiete zuweisen und Links verteilen. Alles Wichtige steht im Menü unten links.',
    'Markieren geht über das grüne Quadrat unten rechts, der Fortschritt steht oben links.' ] },
  'team-editor': { title: 'Hilfe', intro: [
    'Du markierst in den Gebieten deiner Gruppe, welche Häuser und Straßen schon verteilt sind. Das grüne Quadrat unten rechts startet das Markieren, oben links siehst du den Fortschritt.',
    'Alles wird laufend gespeichert und mit den anderen abgeglichen, auch wenn du zwischendurch keinen Empfang hast.' ] },
  viewer: { title: 'Hilfe', intro: [
    'Du siehst den aktuellen Stand der Aktion: welche Straßen und Häuser schon verteilt sind. Zum Markieren brauchst du einen Link für eine Gruppe.',
    'Oben links steht der Fortschritt, tippe darauf für die Übersicht.' ] },
  'collection-collector': { title: 'Hilfe für Helfer', intro: [
    'Du holst im Abholgebiet ab. Übernimm ein Teilgebiet, arbeite es ab und markiere, was erledigt ist.',
    'Alles wird laufend gespeichert und mit den anderen abgeglichen.' ] },
};

const normalize = (text: string) => text.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Frequently asked questions for the signed-in role: a short introduction, a search field and questions that open on tap. */
export function HelpSheet({ role, onClose }: { role: HelpRole; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const entries = useMemo(() => ENTRIES.filter((e) => !e.roles || e.roles.includes(role)), [role]);
  const shown = useMemo(() => {
    const words = normalize(query).split(/\s+/u).filter(Boolean);
    if (!words.length) return entries;
    return entries.filter((e) => { const hay = normalize(`${e.q} ${e.a.join(' ')} ${e.tags ?? ''}`); return words.every((w) => hay.includes(w)); });
  }, [entries, query]);
  const topic = TOPIC[role];
  return (
    <SheetFrame icon="info" title={topic.title} onClose={onClose}>
      <div className="v5-helpintro">{topic.intro.map((line) => <p key={line}>{line}</p>)}</div>
      <input className="v5-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Frage suchen" aria-label="Fragen durchsuchen" autoComplete="off" />
      {shown.length === 0
        ? <p className="v5-hint"><Icon name="info" size={20} />Dazu gibt es keine Frage. Versuch ein anderes Wort.</p>
        : <div className="v5-faq">{shown.map((entry) => (
          <details key={entry.q} className="v5-faqitem">
            <summary>{entry.q}</summary>
            {entry.a.map((line) => <p key={line}>{line}</p>)}
          </details>
        ))}</div>}
    </SheetFrame>
  );
}
