"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import Sidebar from "@/components/Sidebar";
import TopAppBar from "@/components/TopAppBar";
import { fetchAllStops, fetchNearbyStops } from "@/services/api";

type MappedStop = {
  id: string;
  name: string;
  coordinates: [number, number];
  routes: string[];
};

const DEFAULT_CENTER: [number, number] = [79.8612, 6.9271];
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
const HAS_MAPBOX_TOKEN = Boolean(MAPBOX_TOKEN);

// ─────────────────────────────────────────────────────────────────────────────

/** Haversine distance in metres between two lat/lon pairs */
function distanceMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stopDot(selected: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "width:20px",
    "height:20px",
    "border-radius:50%",
    "cursor:pointer",
    "border:3px solid white",
    "box-shadow:0 2px 8px rgba(0,0,0,0.25)",
    "transition:transform 0.15s ease, background 0.15s ease",
    `background:${selected ? "#004ac6" : "#64748b"}`,
  ].join(";");
  return el;
}

function BusStopsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const userMarker = useRef<mapboxgl.Marker | null>(null);
  const markers = useRef<Map<string, mapboxgl.Marker>>(new Map());

  const [stops, setStops] = useState<MappedStop[]>([]);
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [locating, setLocating] = useState(false);
  const [nearbyMode, setNearbyMode] = useState(false);
  const mapLoaded = useRef(false);
  const [isMapReady, setIsMapReady] = useState(false);

  // ── URL parameters ──────────────────────────────────────────────────────
  const queryParam = searchParams.get("query") ?? "";
  const latParam = searchParams.get("lat");
  const lonParam = searchParams.get("lon");
  const selectedParam = searchParams.get("selected");
  const routeIdsParam = searchParams.get("routeIds");
  const routeNumbersParam = searchParams.get("routeNumbers");
  const destinationParam = searchParams.get("destination");

  /** Set of route numbers/names used to filter stops in search mode */
  const routeNumberSet = useMemo<Set<string>>(() => {
    if (!routeNumbersParam) return new Set();
    return new Set(
      routeNumbersParam.split(",").map((s) => s.trim()).filter(Boolean),
    );
  }, [routeNumbersParam]);

  /** True when the user arrived here from a destination search on the home page */
  const isSearchMode = routeNumberSet.size > 0;

  const focusCoords = useMemo<[number, number] | null>(() => {
    const lat = latParam == null ? NaN : Number(latParam);
    const lon = lonParam == null ? NaN : Number(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return [lon, lat];
  }, [latParam, lonParam]);

  useEffect(() => {
    setSearchQuery(queryParam);
  }, [queryParam]);

  // ── Data loading: SEARCH MODE ───────────────────────────────────────────
  // When arriving from a destination search, fetch ALL stops, filter to those
  // serving the matching routes, sort by distance from user, and auto-select
  // the nearest one.
  useEffect(() => {
    if (!isSearchMode) return;

    fetchAllStops()
      .then((data) => {
        const allMapped: MappedStop[] = data
          .filter((s) => s.coordinates)
          .map((s) => ({
            id: String(s.id),
            name: s.name,
            coordinates: s.coordinates as [number, number],
            routes: s.routes,
          }));

        // Filter to stops that serve at least one of the matching routes
        let serving = allMapped.filter((s) =>
          s.routes.some((r) => routeNumberSet.has(r.trim())),
        );

        // If no stops match route numbers, fall back to all stops
        if (serving.length === 0) serving = allMapped;

        // Sort by distance from user's location
        if (focusCoords) {
          const [userLng, userLat] = focusCoords;
          serving.sort((a, b) => {
            const dA = distanceMeters(userLat, userLng, a.coordinates[1], a.coordinates[0]);
            const dB = distanceMeters(userLat, userLng, b.coordinates[1], b.coordinates[0]);
            return dA - dB;
          });
        }

        if (serving.length > 0) {
          setStops(serving);
          setNearbyMode(true);

          // Auto-select: prefer the URL param, fall back to nearest
          const toSelect =
            selectedParam && serving.find((s) => s.id === selectedParam)
              ? selectedParam
              : serving[0].id;
          setSelectedStop(toSelect);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearchMode, routeNumbersParam, focusCoords?.[0], focusCoords?.[1]]);

  // ── Data loading: DEFAULT MODE (no search) ──────────────────────────────
  // When the user navigates to /stops directly (no search), load all stops.
  useEffect(() => {
    if (focusCoords || isSearchMode) return;
    fetchAllStops()
      .then((data) => {
        const mapped: MappedStop[] = data
          .filter((s) => s.coordinates)
          .map((s) => ({
            id: String(s.id),
            name: s.name,
            coordinates: s.coordinates as [number, number],
            routes: s.routes,
          }));
        if (mapped.length > 0) setStops(mapped);
      })
      .catch(() => {});
  }, [focusCoords, isSearchMode]);

  const loadNearbyStops = useCallback((lat: number, lon: number) => {
    return fetchNearbyStops(lat, lon, 1500)
      .then((data) => {
        const mapped: MappedStop[] = data
          .filter((s) => s.coordinates)
          .map((s) => ({
            id: String(s.id),
            name: s.name,
            coordinates: s.coordinates as [number, number],
            routes: s.routes,
          }));
        if (mapped.length > 0) {
          setStops(mapped);
          setNearbyMode(true);
        }
      })
      .catch(() => {});
  }, []);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        userMarker.current?.setLngLat([longitude, latitude]);
        map.current?.flyTo({
          center: [longitude, latitude],
          zoom: 15,
          duration: 900,
        });
        // Load stops near the user
        loadNearbyStops(latitude, longitude).finally(() => setLocating(false));
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [loadNearbyStops]);

  // ── Map initialisation ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    if (!HAS_MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN!;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: DEFAULT_CENTER,
      zoom: 14,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.current.on("load", () => {
      const m = map.current!;
      mapLoaded.current = true;
      setIsMapReady(true);

      // User dot
      const userEl = document.createElement("div");
      userEl.style.cssText =
        "width:18px;height:18px;border-radius:50%;background:#004ac6;border:3px solid white;box-shadow:0 0 0 6px rgba(0,74,198,0.15)";
      userMarker.current = new mapboxgl.Marker({ element: userEl })
        .setLngLat(DEFAULT_CENTER)
        .addTo(m);

      requestAnimationFrame(() => m.resize());
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load nearby stops when focusCoords set WITHOUT search mode ──────────
  useEffect(() => {
    if (isSearchMode) return; // search mode handles its own loading
    if (focusCoords) {
      loadNearbyStops(focusCoords[1], focusCoords[0]);
    }
  }, [focusCoords, loadNearbyStops, isSearchMode]);

  // Update map center and user marker
  useEffect(() => {
    if (focusCoords && isMapReady && map.current) {
      userMarker.current?.setLngLat(focusCoords);
      map.current.flyTo({ center: focusCoords, zoom: 15, duration: 900 });
    }
  }, [focusCoords, isMapReady]);

  // Request location if no focusCoords and not in search mode
  useEffect(() => {
    if (!focusCoords && !isSearchMode && isMapReady) {
      requestLocation();
    }
  }, [focusCoords, isSearchMode, isMapReady, requestLocation]);

  // Sync marker colours with selection
  useEffect(() => {
    markers.current.forEach((marker, id) => {
      const el = marker.getElement();
      const sel = id === selectedStop;
      el.style.background = sel ? "#004ac6" : "#64748b";
      el.style.transform = sel ? "scale(1.35)" : "scale(1)";
    });
  }, [selectedStop]);

  // Add/update map markers whenever stops list changes (API fetch or nearby)
  useEffect(() => {
    if (!map.current || !isMapReady) return;
    // Remove old markers safely
    markers.current.forEach((marker) => marker.remove());
    markers.current.clear();
    // Add new markers
    stops.forEach((stop) => {
      const el = stopDot(stop.id === selectedStop);
      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat(stop.coordinates)
        .addTo(map.current!);
      markers.current.set(stop.id, marker);
      el.addEventListener("click", () => selectStop(stop.id));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, isMapReady]);

  function selectStop(id: string) {
    setSelectedStop(id);
    const stop = stops.find((s) => s.id === id);
    if (stop && map.current) {
      map.current.flyTo({
        center: stop.coordinates,
        zoom: 15.5,
        duration: 700,
      });
    }
  }

  // Pre-select stop from URL (non-search mode only; search mode auto-selects above)
  useEffect(() => {
    if (isSearchMode) return;
    if (isMapReady && stops.length > 0 && selectedParam && !selectedStop) {
      selectStop(selectedParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMapReady, stops, selectedParam, isSearchMode]);

  // When search mode auto-selected a stop AND map is ready, fly to it
  useEffect(() => {
    if (!isSearchMode || !isMapReady || !selectedStop) return;
    const stop = stops.find((s) => s.id === selectedStop);
    if (stop && map.current) {
      map.current.flyTo({
        center: stop.coordinates,
        zoom: 15.5,
        duration: 700,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMapReady, selectedStop, stops.length]);

  const filtered = stops.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // ── Panel header text ───────────────────────────────────────────────────
  const panelTitle = isSearchMode
    ? `Stops to ${destinationParam || "Destination"}`
    : nearbyMode
      ? "Stops Near You"
      : "Nearby Stops";

  return (
    <div className="app-layout">
      <Sidebar />
      <main
        className="main-content"
        style={{ overflow: "hidden", height: "100vh", position: "relative" }}
      >
        <TopAppBar title="Nearby Stops" />

        {HAS_MAPBOX_TOKEN ? (
          <div
            ref={mapContainer}
            style={{ position: "absolute", inset: 0, top: 64, zIndex: 0 }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              top: 64,
              zIndex: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)",
              color: "#334155",
              fontWeight: 700,
            }}
          >
            Stops map unavailable: set NEXT_PUBLIC_MAPBOX_TOKEN
          </div>
        )}

        {/* Search bar */}
        <div className="stops-search-bar glass-panel">
          <span
            className="material-symbols-outlined"
            style={{ color: "var(--color-outline)", fontSize: "20px" }}
          >
            search
          </span>
          <input
            type="text"
            placeholder="Search bus stops…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              fontSize: "0.9375rem",
              color: "var(--color-on-surface)",
              outline: "none",
            }}
          />
          <button
            onClick={requestLocation}
            disabled={locating || !HAS_MAPBOX_TOKEN}
            className="card"
            title="Use my location"
            style={{
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-md)",
              color: locating
                ? "var(--color-primary)"
                : "var(--color-on-surface-variant)",
              flexShrink: 0,
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

        {/* Stop list panel */}
        <div className="stops-list-panel glass-panel">
          {/* Destination context banner (search mode only) */}
          {isSearchMode && destinationParam && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.625rem 0.875rem",
                backgroundColor: "rgba(0,74,198,0.08)",
                borderRadius: "var(--radius-lg)",
                marginBottom: "0.25rem",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "18px", color: "var(--color-primary)" }}
              >
                location_on
              </span>
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "var(--color-primary)",
                }}
              >
                Travelling to {destinationParam}
              </span>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3
              style={{
                fontSize: "1.125rem",
                fontWeight: 700,
                color: "var(--color-on-surface)",
              }}
            >
              {panelTitle}
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {nearbyMode && !isSearchMode && (
                <button
                  onClick={() => {
                    setNearbyMode(false);
                    fetchAllStops()
                      .then((data) => {
                        const mapped: MappedStop[] = data
                          .filter((s) => s.coordinates)
                          .map((s) => ({
                            id: String(s.id),
                            name: s.name,
                            coordinates: s.coordinates as [number, number],
                            routes: s.routes,
                          }));
                        if (mapped.length > 0) setStops(mapped);
                      })
                      .catch(() => {});
                  }}
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--color-primary)",
                    textDecoration: "underline",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                  }}
                >
                  Show All
                </button>
              )}
            <span
              style={{
                fontSize: "0.875rem",
                color: "var(--color-on-surface-variant)",
                fontWeight: 500,
              }}
            >
              {filtered.length} found
            </span>
            </div>
          </div>

          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            {filtered.map((stop) => (
              <button
                key={stop.id}
                onClick={() => selectStop(stop.id)}
                className="card"
                style={{
                  padding: "0.875rem 1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.875rem",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  outline:
                    selectedStop === stop.id
                      ? "2px solid var(--color-primary)"
                      : "none",
                  outlineOffset: "2px",
                  backgroundColor:
                    selectedStop === stop.id
                      ? "rgba(0,74,198,0.07)"
                      : "var(--color-surface-container-lowest)",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    backgroundColor:
                      selectedStop === stop.id
                        ? "var(--color-primary)"
                        : "var(--color-surface-container)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: "22px",
                      color:
                        selectedStop === stop.id
                          ? "white"
                          : "var(--color-on-surface-variant)",
                      fontVariationSettings: "'FILL' 1",
                    }}
                  >
                    place
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color: "var(--color-on-surface)",
                      marginBottom: "0.2rem",
                    }}
                  >
                    {stop.name}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8125rem",
                      color: "var(--color-on-surface-variant)",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "13px" }}
                    >
                      route
                    </span>
                    {stop.routes.join(", ")}
                  </div>
                </div>
                {selectedStop === stop.id && (
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: "20px",
                      color: "var(--color-primary)",
                      fontVariationSettings: "'FILL' 1",
                      flexShrink: 0,
                    }}
                  >
                    check_circle
                  </span>
                )}
              </button>
            ))}
          </div>

          {selectedStop && (
            <button
              className="btn-primary"
              style={{ width: "100%" }}
              onClick={() => {
                const stop = stops.find((s) => s.id === selectedStop);
                const name = stop?.name ?? selectedStop;
                const qs = new URLSearchParams();
                qs.set("id", selectedStop);
                qs.set("name", name);
                if (routeIdsParam) {
                  qs.set("routeIds", routeIdsParam);
                }
                router.push(`/stop-details?${qs.toString()}`);
              }}
            >
              View Available Buses
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px" }}
              >
                arrow_forward
              </span>
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

export default function BusStopsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BusStopsContent />
    </Suspense>
  );
}
