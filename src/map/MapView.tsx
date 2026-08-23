import { useEffect, useRef, useState } from "react";
import { GeolocateControl, Map, NavigationControl } from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const CARTO_RETINA_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 20,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a> · <a href="https://carto.com/attributions" target="_blank">© CARTO</a>',
    },
  },
  layers: [
    {
      id: "map-background",
      type: "background",
      paint: {
        "background-color": "#e8ece8",
      },
    },
    {
      id: "carto-basemap",
      type: "raster",
      source: "carto",
      minzoom: 0,
      maxzoom: 20,
      paint: {
        "raster-fade-duration": 0,
      },
    },
  ],
} satisfies StyleSpecification;

type MapInstance = Map;

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let active = true;

    try {
      const map = new Map({
        container: containerRef.current,
        style: CARTO_RETINA_STYLE,
        center: [10.45, 51.16],
        zoom: 5.3,
        maxZoom: 20,
        renderWorldCopies: false,
        cancelPendingTileRequestsWhileZooming: false,
        validateStyle: import.meta.env.DEV,
      });

      map.once("idle", () => {
        if (active) setLoading(false);
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
      if (active) {
        setLoading(false);
        setError("Die Karte konnte nicht geladen werden.");
      }
    }

    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <section className="map-region" aria-label="Verteilkarte">
      <div ref={containerRef} className="map" />
      {loading ? <div className="map-loading">Karte lädt…</div> : null}
      {error ? <div className="map-error">{error}</div> : null}
    </section>
  );
}
