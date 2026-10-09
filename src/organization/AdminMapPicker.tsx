import { useEffect, useRef, useState } from "react";
import "../mapRuntime.ts";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Icon, readTheme } from "../ui/index.ts";

type MapFocus = { lng: number; lat: number; zoom: number; bearing: number };
type Props = { value: MapFocus; onChange: (value: MapFocus) => void };

/** Plain background: used when the deployment serves no basemap or it cannot be loaded. The focus can still be placed with the crosshair numbers. */
const plain = (dark: boolean): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": dark ? "#151c1b" : "#e7eeeb" } }] });

/** The deployment's basemap style (never hard-coded here); null when it serves none. */
async function loadBasemap(): Promise<string | null> {
  try {
    const response = await fetch("/api/v5/basemap", { credentials: "same-origin" });
    if (!response.ok) return null;
    const { basemap } = (await response.json()) as { basemap: { dark: string | null; light: string | null } | null };
    return (readTheme() === "dark" ? basemap?.dark : basemap?.light) ?? null;
  } catch {
    return null;
  }
}

export function AdminMapPicker({ value, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    let map: maplibregl.Map | null = null;
    let cancelled = false;
    const dark = readTheme() === "dark";
    void loadBasemap().then((style) => {
      if (cancelled || !host.current) return;
      map = new maplibregl.Map({
        container: host.current,
        style: style ?? plain(dark),
        center: [value.lng, value.lat],
        zoom: value.zoom,
        bearing: value.bearing,
        attributionControl: { compact: true },
      });
      // A basemap that cannot be fetched must not leave a broken picker: fall back to the plain background once.
      let fellBack = !style;
      map.on("error", (event) => {
        if (fellBack || !map) return;
        const status = (event.error as { status?: number } | undefined)?.status;
        if (status === undefined || status >= 400) { fellBack = true; setOffline(true); map.setStyle(plain(dark)); }
      });
      map.on("moveend", () => {
        if (!map) return;
        const center = map.getCenter();
        onChangeRef.current({ lng: Number(center.lng.toFixed(6)), lat: Number(center.lat.toFixed(6)), zoom: Number(map.getZoom().toFixed(2)), bearing: Number(map.getBearing().toFixed(2)) });
      });
    });
    return () => { cancelled = true; map?.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ui-form">
      <div className="ui-map">
        <div ref={host} style={{ position: "absolute", inset: 0 }} aria-label="Kartenfokus der Aktion" />
        <div className="ui-crosshair" aria-hidden="true"><Icon name="plus" size={28} /></div>
      </div>
      <p className="ui-muted">
        Kartenmitte verschieben und Zoom wählen. Gespeichert wird der sichtbare Fokus: {value.lat.toFixed(5)}, {value.lng.toFixed(5)} · Zoom {value.zoom.toFixed(1)}
        {offline ? " · Karte nicht erreichbar, einfacher Hintergrund" : ""}
      </p>
    </div>
  );
}
