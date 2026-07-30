import L, {
  type Circle,
  type LatLngExpression,
  type LatLngTuple,
  type Map as LeafletMap,
  type Marker,
  type Polyline,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import "./LiveLocationMap.css";

type LiveLocationMapProps = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  followMarker?: boolean;
  destination?: {
    latitude: number;
    longitude: number;
  };
  routeCoordinates?: {
    latitude: number;
    longitude: number;
  }[];
  zoom?: number;
  className?: string;
};

const liveLocationIcon = L.divIcon({
  className: "live-location-marker-host",
  html: '<span class="live-location-marker-dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const destinationIcon = L.divIcon({
  className: "live-direction-destination-host",
  html: '<span class="live-direction-destination-dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export function LiveLocationMap({
  latitude,
  longitude,
  accuracyMeters = null,
  followMarker = true,
  destination,
  routeCoordinates,
  zoom = 16,
  className = "",
}: LiveLocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const destinationMarkerRef = useRef<Marker | null>(null);
  const routeLineRef = useRef<Polyline | null>(null);
  const accuracyCircleRef = useRef<Circle | null>(null);
  const initialPositionRef = useRef<LatLngExpression>([latitude, longitude]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
    }).setView(initialPositionRef.current, zoom);

    L.control.zoom({ position: "topright" }).addTo(map);

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
      destinationMarkerRef.current = null;
      markerRef.current = null;
      routeLineRef.current = null;
      mapRef.current = null;
    };
  }, [zoom]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    const position: LatLngTuple = [latitude, longitude];
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

    if (destination) {
      const destinationPosition: LatLngTuple = [
        destination.latitude,
        destination.longitude,
      ];
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.setLatLng(destinationPosition);
      } else {
        destinationMarkerRef.current = L.marker(destinationPosition, {
          icon: destinationIcon,
          keyboard: true,
          title: "Shared location",
          alt: "Shared location",
        }).addTo(map);
      }

      const routePositions: LatLngTuple[] = (routeCoordinates ?? []).map(
        (coordinate) => [coordinate.latitude, coordinate.longitude],
      );
      if (routePositions.length > 1) {
        if (routeLineRef.current) {
          routeLineRef.current.setLatLngs(routePositions);
        } else {
          routeLineRef.current = L.polyline(routePositions, {
            color: "#19383d",
            weight: 5,
            opacity: 0.85,
            interactive: false,
          }).addTo(map);
        }
      } else {
        routeLineRef.current?.remove();
        routeLineRef.current = null;
      }

      map.fitBounds(
        routePositions.length > 1
          ? routePositions
          : [position, destinationPosition],
        {
        animate: true,
        maxZoom: 16,
        padding: [36, 36],
        },
      );
    } else {
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
      routeLineRef.current?.remove();
      routeLineRef.current = null;
    }

    if (followMarker && !destination) {
      map.panTo(position, {
        animate: true,
        duration: 0.5,
      });
    }
  }, [
    accuracyMeters,
    destination,
    followMarker,
    latitude,
    longitude,
    routeCoordinates,
  ]);

  return (
    <div
      ref={containerRef}
      className={`live-location-map ${className}`.trim()}
      role="img"
      aria-label="Live location map"
    />
  );
}
