"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import Sidebar from "@/components/Sidebar";
import TopAppBar from "@/components/TopAppBar";
import { fetchAllStops, fetchAllTransitRoutes, searchRoutes } from "@/services/api";

const DEFAULT_CENTER: [number, number] = [79.8612, 6.9271];
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
const HAS_MAPBOX_TOKEN = Boolean(MAPBOX_TOKEN);

export default function RoutesPage() {
  const router = useRouter();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const userMarker = useRef<mapboxgl.Marker | null>(null);

  const [locating, setLocating] = useState(false);
  const [originLabel, setOriginLabel] = useState("Current Location");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const userCoords = useRef<[number, number] | null>(null);

  function flyToUser(lng: number, lat: number) {
    userMarker.current?.setLngLat([lng, lat]);
    map.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 1000 });
  }

  async function fetchLocationByIP() {
    try {
      const res = await fetch("https://ipapi.co/json/");
      const data = await res.json();
      if (data.latitude && data.longitude) {
        flyToUser(data.longitude, data.latitude);
        userCoords.current = [data.longitude, data.latitude];
        setOriginLabel("My Location");
        return;
      }
    } catch {
      // fall through
    } finally {
      setLocating(false);
    }
    // All location methods failed — let user type a start location
    setOriginLabel("");
  }

  function requestLocation() {
    setLocating(true);
    if (!navigator.geolocation) {
      fetchLocationByIP();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        flyToUser(pos.coords.longitude, pos.coords.latitude);
        userCoords.current = [pos.coords.longitude, pos.coords.latitude];
        setOriginLabel("My Location");
        setLocating(false);
      },
      () => fetchLocationByIP(),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function geocode(place: string): Promise<[number, number] | null> {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(place)}.json?access_token=${MAPBOX_TOKEN}&country=LK&limit=1`,
    );
    const data = await res.json();
    const center = data.features?.[0]?.center;
    return center ? [center[0], center[1]] : null;
  }

  function distanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371000 * c;
  }

  async function resolveNearestStartStop(
    routes: { start_stop_name: string; route_id: number }[],
    originLat: number,
    originLng: number,
  ): Promise<{ id: string; name: string } | null> {
    const stops = await fetchAllStops();
    const normalizedStops = stops
      .filter((s) => s.coordinates)
      .map((s) => ({
        id: String(s.id),
        name: s.name,
        coordinates: s.coordinates as [number, number],
        key: s.name.toLowerCase().trim(),
      }));

    let bestStop: { id: string; name: string } | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const route of routes) {
      const key = route.start_stop_name.toLowerCase().trim();
      for (const stop of normalizedStops) {
        if (stop.key !== key) continue;
        const [lng, lat] = stop.coordinates;
        const dist = distanceMeters(originLat, originLng, lat, lng);
        if (dist < bestDist) {
          bestDist = dist;
          bestStop = { id: stop.id, name: stop.name };
        }
      }
    }

    if (bestStop) return bestStop;

    const fallbackName = routes[0]?.start_stop_name?.toLowerCase().trim();
    if (!fallbackName) return null;
    const fallback = normalizedStops.find((stop) => stop.key === fallbackName);
    return fallback ? { id: fallback.id, name: fallback.name } : null;
  }

  function buildStopsUrl(query?: string, lat?: number, lon?: number) {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (lat != null && lon != null) {
      params.set("lat", String(lat));
      params.set("lon", String(lon));
    }
    const qs = params.toString();
    return qs ? `/stops?${qs}` : "/stops";
  }

  async function handleSearch() {
    const destination = destinationLabel.trim();
    if (!destination) {
      router.push("/stops");
      return;
    }
    if (!HAS_MAPBOX_TOKEN) {
      router.push(buildStopsUrl(destination));
      return;
    }
    setIsSearching(true);
    try {
      // Geocode destination to find routes that connect the user to it.
      const destCoords = await geocode(destination);
      if (!destCoords) {
        router.push(buildStopsUrl(destination));
        return;
      }
      const [destLng, destLat] = destCoords;

      // Resolve origin: use GPS if available, otherwise geocode the typed label
      let originLng: number;
      let originLat: number;
      if (userCoords.current) {
        [originLng, originLat] = userCoords.current;
      } else if (originLabel.trim() && originLabel !== "Current Location") {
        const originCoords = await geocode(originLabel);
        if (!originCoords) {
          router.push(buildStopsUrl(destination));
          return;
        }
        [originLng, originLat] = originCoords;
      } else {
        router.push(buildStopsUrl(destination));
        return;
      }

      const result = await searchRoutes(originLat, originLng, destLat, destLng);
      if (result.count <= 0) {
        router.push(buildStopsUrl(destination, destLat, destLng));
        return;
      }

      const routeIds = result.routes.map((r) => r.route_id).join(",");
      const nearestStop = await resolveNearestStartStop(
        result.routes,
        originLat,
        originLng,
      );

      if (!nearestStop) {
        router.push(buildStopsUrl(destination, originLat, originLng));
        return;
      }

      // Direct user to nearby stops (centered on their location)
      // Pass the nearest stop ID to pre-select it, and routeIds to forward to stop-details
      const params = new URLSearchParams();
      params.set("lat", String(originLat));
      params.set("lon", String(originLng));
      params.set("selected", nearestStop.id);
      params.set("routeIds", routeIds);
      
      router.push(`/stops?${params.toString()}`);
    } catch {
      router.push(buildStopsUrl(destination));
    } finally {
      setIsSearching(false);
    }
  }

  useEffect(() => {

    mapboxgl.accessToken = MAPBOX_TOKEN!;

    if (!mapContainer.current) return;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: DEFAULT_CENTER,
      zoom: 13,
      interactive: false,
    });

    map.current.on("load", () => {
      const m = map.current!;

      // Draw routes from API
      fetchAllTransitRoutes()
        .then((routesMap) => {
          Object.values(routesMap).forEach((route) => {
            if (!route.path?.length) return;
            m.addSource(`route-${route.id}`, {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: route.path },
              },
            });
            m.addLayer({
              id: `route-${route.id}`,
              type: "line",
              source: `route-${route.id}`,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": route.color || "#004ac6",
                "line-width": 3,
                "line-opacity": 0.75,
              },
            });

            // Stop markers
            const seen = new Set<string>();
            route.stops?.forEach((stop) => {
              const key = stop.coordinates.join(",");
              if (seen.has(key)) return;
              seen.add(key);
              const el = document.createElement("div");
              el.style.cssText =
                "width:10px;height:10px;border-radius:50%;background:white;border:2.5px solid #004ac6;box-shadow:0 1px 4px rgba(0,74,198,0.3)";
              new mapboxgl.Marker({ element: el })
                .setLngLat(stop.coordinates)
                .setPopup(
                  new mapboxgl.Popup({ offset: 10, closeButton: false }).setText(
                    stop.name,
                  ),
                )
                .addTo(m);
            });
          });
        })
        .catch(() => {});

      // User dot
      const userEl = document.createElement("div");
      userEl.style.cssText =
        "width:16px;height:16px;border-radius:50%;background:#004ac6;border:3px solid white;box-shadow:0 0 0 5px rgba(0,74,198,0.2)";
      userMarker.current = new mapboxgl.Marker({ element: userEl })
        .setLngLat(DEFAULT_CENTER)
        .addTo(m);

      requestLocation();
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <TopAppBar title="On Time" />

        <div
          className="page-enter page-content-padded"
          style={{ maxWidth: "1280px", margin: "0 auto" }}
        >
          <div className="home-grid">
            {/* Search panel */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              <div>
                <h2
                  className="home-headline"
                  style={{
                    fontSize: "2.5rem",
                    fontWeight: 800,
                    color: "var(--color-on-surface)",
                    letterSpacing: "-0.025em",
                    marginBottom: "0.5rem",
                  }}
                >
                  Where to?
                </h2>
                <p
                  style={{
                    color: "var(--color-on-surface-variant)",
                    fontWeight: 500,
                  }}
                >
                  Find the best route across the transit network.
                </p>
              </div>

              <div
                className="card"
                style={{
                  padding: "1.5rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                <div className="input-wrapper">
                  <div className="input-icon">
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: "18px",
                        fontVariationSettings: "'FILL' 1",
                      }}
                    >
                      my_location
                    </span>
                  </div>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Search start location…"
                    value={originLabel}
                    onChange={(e) => setOriginLabel(e.target.value)}
                  />
                </div>

                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: "1.25rem",
                      width: "2px",
                      height: "24px",
                      backgroundColor: "var(--color-surface-container-high)",
                    }}
                  />
                  <button
                    aria-label="Swap"
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      backgroundColor: "var(--color-surface-container-low)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-outline)",
                      marginLeft: "auto",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "16px" }}
                    >
                      swap_vert
                    </span>
                  </button>
                </div>

                <div className="input-wrapper">
                  <div
                    className="input-icon"
                    style={{ color: "var(--color-outline-variant)" }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "18px" }}
                    >
                      location_on
                    </span>
                  </div>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Destination"
                    value={destinationLabel}
                    onChange={(e) => setDestinationLabel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    marginTop: "0.25rem",
                  }}
                >
                  <button className="btn-secondary">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "16px" }}
                    >
                      schedule
                    </span>
                    Leave Now
                  </button>
                  <button className="btn-chip">Options</button>
                </div>

                <button
                  className="btn-primary"
                  style={{ marginTop: "0.25rem" }}
                  onClick={handleSearch}
                  disabled={isSearching}
                >
                  {isSearching ? "Searching…" : "Search Route"}
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "20px" }}
                  >
                    {isSearching ? "progress_activity" : "arrow_forward"}
                  </span>
                </button>
              </div>
              
            </div>

            {/* Mapbox preview */}
            <div className="home-map">
              {HAS_MAPBOX_TOKEN ? (
                <div
                  ref={mapContainer}
                  style={{ position: "absolute", inset: 0 }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background:
                      "linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)",
                    color: "#1e3a8a",
                    fontWeight: 700,
                  }}
                >
                  Map preview unavailable: set NEXT_PUBLIC_MAPBOX_TOKEN
                </div>
              )}
              <div
                className="glass-panel"
                style={{
                  position: "absolute",
                  bottom: "1.5rem",
                  left: "1.5rem",
                  right: "1.5rem",
                  borderRadius: "var(--radius-lg)",
                  padding: "0.875rem 1.25rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                  }}
                >
                  <div className="live-dot" />
                  <span
                    style={{
                      fontSize: "0.875rem",
                      fontWeight: 700,
                      color: "var(--color-on-surface)",
                    }}
                  >
                    Live Network:{" "}
                    <span style={{ color: "#16a34a" }}>Good Service</span>
                  </span>
                </div>
                <button
                  onClick={requestLocation}
                  disabled={locating || !HAS_MAPBOX_TOKEN}
                  className="card"
                  style={{
                    width: 36,
                    height: 36,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "var(--radius-md)",
                    color: locating
                      ? "var(--color-primary)"
                      : "var(--color-on-surface)",
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "18px" }}
                  >
                    {locating ? "progress_activity" : "my_location"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
