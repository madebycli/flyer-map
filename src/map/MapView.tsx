import { useEffect, useRef, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const VECTOR_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const RASTER_FALLBACK_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
    },
  },
  layers: [
    {
      id: "osm-basemap",
      type: "raster",
      source: "osm",
    },
  ],
} satisfies StyleSpecification;

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
          style: VECTOR_STYLE,
          center: [10.45, 51.16],
          zoom: 5.3,
          maxZoom: 19,
        });

        let primaryReady = false;
        let fallbackActivated = false;

        const activateFallback = () => {
          if (!active || fallbackActivated) return;

          fallbackActivated = true;
          setError(null);
          map.setStyle(RASTER_FALLBACK_STYLE);
        };

        const fallbackTimer = window.setTimeout(() => {
          if (!primaryReady) activateFallback();
        }, 6000);

        map.once("idle", () => {
          primaryReady = true;
          window.clearTimeout(fallbackTimer);
        });

        map.on("error", () => {
          if (!primaryReady) activateFallback();
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
