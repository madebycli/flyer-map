import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

type MapInstance = import("maplibre-gl").Map;

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function createMap() {
      if (!containerRef.current || mapRef.current) return;

      try {
        const { GeolocateControl, Map, NavigationControl } = await import("maplibre-gl");
        if (!active || !containerRef.current) return;

        const map = new Map({
          container: containerRef.current,
          style: MAP_STYLE,
          center: [10.45, 51.16],
          zoom: 5.3,
          attributionControl: true,
        });

        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        map.addControl(
          new GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showUserLocation: true,
            showAccuracyCircle: true,
          }),
          "top-right",
        );

        mapRef.current = map;
      } catch {
        if (active) setError("Die Karte konnte nicht geladen werden.");
      }
    }

    void createMap();

    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <section className="map-region" aria-label="Verteilkarte">
      <div ref={containerRef} className="map" />
      {error ? <div className="map-error">{error}</div> : null}
    </section>
  );
}
