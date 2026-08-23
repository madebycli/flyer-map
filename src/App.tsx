import { useEffect, useState } from "react";
import { MapView } from "./map/MapView";

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

export default function App() {
  const online = useOnlineStatus();

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <strong>Verteil-Flyer</strong>
          <span className="subtitle">Karten-Prototyp</span>
        </div>
        <span className={`connection ${online ? "is-online" : "is-offline"}`}>
          {online ? "Online" : "Offline"}
        </span>
      </header>

      <MapView />

      <section className="field-card" aria-label="Projektstatus">
        <div>
          <span className="eyebrow">Foundation</span>
          <strong>Karte & Standortbasis</strong>
        </div>
        <p>
          Dein Standort wird nur im Browser für die Kartenanzeige verwendet und
          von Verteil-Flyer nicht gespeichert.
        </p>
      </section>
    </main>
  );
}
