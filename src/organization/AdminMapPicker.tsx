import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type MapFocus = { lng: number; lat: number; zoom: number; bearing: number };

type Props = {
  value: MapFocus;
  onChange: (value: MapFocus) => void;
};

const osmStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export function AdminMapPicker({ value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: [value.lng, value.lat],
      zoom: value.zoom,
      bearing: value.bearing,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    const publish = () => {
      const center = map.getCenter();
      onChangeRef.current({
        lng: Number(center.lng.toFixed(6)),
        lat: Number(center.lat.toFixed(6)),
        zoom: Number(map.getZoom().toFixed(2)),
        bearing: Number(map.getBearing().toFixed(2)),
      });
    };
    map.on("moveend", publish);
    mapRef.current = map;
    return () => {
      map.off("moveend", publish);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="org-map-picker">
      <div ref={containerRef} className="org-map-picker__map" aria-label="Kartenfokus der Aktion" />
      <div className="org-map-picker__crosshair" aria-hidden="true">+</div>
      <p>
        Kartenmitte verschieben und Zoom wählen. Gespeichert wird der sichtbare Fokus: {value.lat.toFixed(5)}, {value.lng.toFixed(5)} · Zoom {value.zoom.toFixed(1)}
      </p>
    </div>
  );
}
