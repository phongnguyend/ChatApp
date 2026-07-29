import L, {
  type Circle,
  type LatLngExpression,
  type Map as LeafletMap,
  type Marker,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import "./LiveLocationMap.css";

type LiveLocationMapProps = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  followMarker?: boolean;
  zoom?: number;
  className?: string;
};

const liveLocationIcon = L.divIcon({
  className: "live-location-marker-host",
  html: '<span class="live-location-marker-dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export function LiveLocationMap({
  latitude,
  longitude,
  accuracyMeters = null,
  followMarker = true,
  zoom = 16,
  className = "",
}: LiveLocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const accuracyCircleRef = useRef<Circle | null>(null);
  const initialPositionRef = useRef<LatLngExpression>([latitude, longitude]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
    }).setView(initialPositionRef.current, zoom);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">' +
        "OpenStreetMap contributors</a>",
    }).addTo(map);

    const marker = L.marker(initialPositionRef.current, {
      icon: liveLocationIcon,
      keyboard: true,
      title: "Live location",
      alt: "Live location",
    }).addTo(map);

    mapRef.current = map;
    markerRef.current = marker;

    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      accuracyCircleRef.current = null;
      markerRef.current = null;
      mapRef.current = null;
    };
  }, [zoom]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    const position: LatLngExpression = [latitude, longitude];
    marker.setLatLng(position);

    if (accuracyMeters !== null && accuracyMeters > 0) {
      if (accuracyCircleRef.current) {
        accuracyCircleRef.current
          .setLatLng(position)
          .setRadius(accuracyMeters);
      } else {
        accuracyCircleRef.current = L.circle(position, {
          radius: accuracyMeters,
          color: "#da7460",
          weight: 1,
          fillColor: "#da7460",
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(map);
      }
    } else if (accuracyCircleRef.current) {
      accuracyCircleRef.current.remove();
      accuracyCircleRef.current = null;
    }

    if (followMarker) {
      map.panTo(position, {
        animate: true,
        duration: 0.5,
      });
    }
  }, [accuracyMeters, followMarker, latitude, longitude]);

  return (
    <div
      ref={containerRef}
      className={`live-location-map ${className}`.trim()}
      role="img"
      aria-label="Live location map"
    />
  );
}
