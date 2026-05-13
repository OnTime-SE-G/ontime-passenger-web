"use client";
import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import Sidebar from "@/components/Sidebar";
import TopAppBar from "@/components/TopAppBar";
import {
  interpolate,
  getBearing,
  splitPath,
  getStopState,
  stopTimeLabel,
  type TransitRoute,
  type RouteStop,
} from "@/lib/transitData";
import type { StopEta } from "@/lib/socket/socketTypes";
import { fetchAllTransitRoutes, fetchLiveBuses } from "@/services/api";
import { useBusTracking } from "@/hooks/useBusTracking";

function liveStopLabel(
  stop: RouteStop,
  i: number,
  totalStops: number,
  prog: number,
  stopEtas: StopEta[] | undefined,
): string {
  if (!stopEtas || stopEtas.length === 0) {
    // No live data yet — use position-based formula
    return stopTimeLabel(i, totalStops, prog);
  }

  const stopNameKey = stop.name.toLowerCase().trim();
  const matchIdx = stopEtas.findIndex(
    (s) => (s.stopName ?? "").toLowerCase().trim() === stopNameKey,
  );

  if (matchIdx === -1) {
    // Stop not in upcoming list but we have live data → already passed
    return "Departed";
  }

  const mins = Math.max(1, Math.round(stopEtas[matchIdx].etaSeconds / 60));
  return matchIdx === 0 ? `Arriving ~${mins} min` : `~${mins} min`;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
const HAS_MAPBOX_TOKEN = Boolean(MAPBOX_TOKEN);

function TrackingContent() {
  const searchParams = useSearchParams();

  // rawBusId from URL (e.g. "1" or "BUS-01"), activeBusId is resolved from REST/socket
  const rawBusId   = searchParams.get("bus")?.toUpperCase() ?? "";
  const localBusId = rawBusId.replace(/^BUS-0*/i, "");
  const routeParam = searchParams.get("route") ?? "";
  const routeDbId  = searchParams.get("routeDbId") ?? "";
  const hasSelection = Boolean(routeParam || rawBusId);

  // activeBusId is set to the real backend busId once the REST snapshot resolves it;
  // this ensures buses.get(activeBusId) stays in sync with WebSocket updates.
  const [activeBusId, setActiveBusId] = useState(rawBusId);

  const [route, setRoute] = useState<TransitRoute | null>(null);
  const router = useRouter();

  // Fetch real route geometry from the API
  useEffect(() => {
    if (!routeParam) return;
    fetchAllTransitRoutes()
      .then((all) => {
        const found = Object.values(all).find(
          (r) => r.number === routeParam || r.id === routeParam,
        );
        if (found && found.path?.length > 1) {
          setRoute(found as TransitRoute);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParam]);

  const mapContainer = useRef<HTMLDivElement>(null);
  const map          = useRef<mapboxgl.Map | null>(null);
  const busMarker    = useRef<mapboxgl.Marker | null>(null);
  const progress     = useRef(0);

  const [speed, setSpeed] = useState(42);
  const [prog,  setProg]  = useState(0);

  // ── Live socket data ─────────────────────────────────────────────
  const { buses, connectionStatus, updateBus } = useBusTracking();
  // activeBusId is the real backend busId resolved from REST snapshot;
  // it matches the key WebSocket updates use (e.g. "1") so live data wires up.
  const liveBus = buses.get(activeBusId);
  const isWaitingForLiveData = connectionStatus === "connected" && !liveBus;

  // ── REST snapshot: seed live bus data before socket fires ──────────────────
  useEffect(() => {
    fetchLiveBuses()
      .then((all) => {
        const match = all.find(
          (b) =>
            String(b.id) === rawBusId ||
            b.fleet_code?.toUpperCase() === rawBusId ||
            (routeDbId && String(b.route_id) === routeDbId),
        );
        if (match?.latitude != null && match?.longitude != null) {
          // Use the actual backend busId (DB integer as string) so the Zustand
          // key matches what WebSocket messages send (e.g. "1", not "BUS-01").
          const resolvedId = String(match.id);
          setActiveBusId(resolvedId);
          updateBus({
            busId: resolvedId,
            routeId: routeParam || String(match.route_id ?? ""),
            lat: match.latitude,
            lng: match.longitude,
            speed: 0,
            heading: 0,
            timestamp: Date.now(),
            occupancy: "medium",
            status: match.status === "active" ? "active" : "delayed",
            driverName: match.fleet_code ?? "",
            eta: 0,
          });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawBusId, routeDbId]);

  // ── BUG 1 FIX: stable ref so animation loop never restarts on socket tick ─
  // liveBus is kept in a ref; the interval reads liveBusRef.current which is
  // always fresh without liveBus appearing in the dep array.
  const liveBusRef = useRef(liveBus);
  useEffect(() => { liveBusRef.current = liveBus; }, [liveBus]);

  useEffect(() => {
    if (!liveBus) return;
    console.log("[Tracking] Live update:", liveBus);
  }, [liveBus]);

  // ── Derived values: liveBus preferred, static bus as fallback ────────────
  const liveStatus = liveBus?.status     ?? "active";
  const liveRoute  = liveBus?.routeId    ?? routeParam;
  const liveName   = liveBus?.driverName ?? "";

  const eta     = Math.max(1, Math.round((1 - prog) * 28));
  const liveEta = liveBus?.eta || eta;
  const liveSpd = liveBus ? Math.round(liveBus.speed) : speed;

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!route) return; // no route selected yet
    if (!mapContainer.current || map.current) return;
    if (!HAS_MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN!;
    const startPos = interpolate(route.path, 0);

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: startPos,
      zoom: 14,
    });
    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.current.addControl(new mapboxgl.ScaleControl(), "bottom-left");

    map.current.on("load", () => {
      const m = map.current!;

      // Passed segment
      m.addSource("passed", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [startPos] } },
      });
      m.addLayer({
        id: "passed", type: "line", source: "passed",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#94a3b8", "line-width": 4, "line-opacity": 0.6, "line-dasharray": [2, 2] },
      });

      // Ahead segment
      m.addSource("ahead", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.path } },
      });
      m.addLayer({
        id: "ahead-outline", type: "line", source: "ahead",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.4 },
      });
      m.addLayer({
        id: "ahead", type: "line", source: "ahead",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": route.color, "line-width": 4 },
      });

      // Stop markers
      route.stops.forEach((stop, i) => {
        const state = getStopState(i, route.stops.length, progress.current);
        const el = document.createElement("div");
        el.style.cssText = `width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2);background:${
          state === "passed" ? "#94a3b8" : state === "current" ? route.color : "white"
        }`;
        el.id = `stop-${i}`;
        new mapboxgl.Marker({ element: el })
          .setLngLat(stop.coordinates)
          .setPopup(new mapboxgl.Popup({ offset: 10, closeButton: false }).setText(stop.name))
          .addTo(m);
      });

      // Bus marker
      const busEl = document.createElement("div");
      busEl.style.cssText = "width:52px;height:52px;cursor:pointer";
      busEl.innerHTML = `
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style="filter:drop-shadow(0 4px 12px rgba(0,0,0,0.45))">
          <!-- Pulse ring -->
          <circle cx="26" cy="26" r="25" fill="${route.color}" opacity="0.18"/>
          <!-- Body -->
          <rect x="10" y="14" width="32" height="22" rx="5" fill="${route.color}"/>
          <!-- Roof highlight -->
          <rect x="12" y="14" width="28" height="7" rx="3" fill="white" opacity="0.2"/>
          <!-- Windows row -->
          <rect x="14" y="17" width="6" height="5" rx="1.5" fill="white" opacity="0.9"/>
          <rect x="23" y="17" width="6" height="5" rx="1.5" fill="white" opacity="0.9"/>
          <rect x="32" y="17" width="6" height="5" rx="1.5" fill="white" opacity="0.9"/>
          <!-- Door -->
          <rect x="21" y="27" width="10" height="9" rx="1.5" fill="white" opacity="0.35"/>
          <!-- Wheels -->
          <circle cx="17" cy="37" r="4" fill="#1e293b"/>
          <circle cx="17" cy="37" r="2" fill="#94a3b8"/>
          <circle cx="35" cy="37" r="4" fill="#1e293b"/>
          <circle cx="35" cy="37" r="2" fill="#94a3b8"/>
          <!-- Direction arrow on top -->
          <path d="M26 3 L30 10 L26 8 L22 10 Z" fill="${route.color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>`;
      busMarker.current = new mapboxgl.Marker({
        element: busEl, rotationAlignment: "map", pitchAlignment: "map",
      }).setLngLat(startPos).addTo(m);
    });

    return () => { map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id]);

  // ── Animation loop ────────────────────────────────────────────────────────
  // Reads liveBusRef.current (not liveBus directly) so the interval is only
  // created/torn-down when localBusId changes — never on every socket tick.
  // This eliminates the 1.6 s marker stutter caused by the old dep array.
  useEffect(() => {
    if (!route) return; // no route selected yet
    const id = setInterval(() => {
      const live = liveBusRef.current; // always fresh, no re-mount needed

      // Only update marker when real live data exists — no fake movement
      if (!live) return;

      const pos: [number, number] = [live.lng, live.lat];
      const p = progress.current;
      const brg = getBearing(route.path, p);

      busMarker.current?.setLngLat(pos);
      busMarker.current?.setRotation(brg);
      map.current?.flyTo({ center: pos, zoom: map.current.getZoom(), duration: 800 });

      if (map.current?.isStyleLoaded()) {
        const { passed, ahead } = splitPath(route.path, p);
        (map.current.getSource("passed") as mapboxgl.GeoJSONSource)?.setData({
          type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: passed },
        });
        (map.current.getSource("ahead") as mapboxgl.GeoJSONSource)?.setData({
          type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ahead },
        });
      }

      setSpeed(Math.round(live.speed));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id]); // ← liveBus removed; ref handles updates silently

  // ── No route selected — show empty state ────────────────────────────────
  if (!hasSelection || !route) {
    return (
      <div className="app-layout">
        <Sidebar />
        <main className="main-content" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
          <div style={{ textAlign: "center", maxWidth: 400 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 72, color: "var(--color-outline-variant)", fontVariationSettings: "'FILL' 1" }}>directions_bus</span>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-on-surface)", margin: "1rem 0 0.5rem" }}>No Route Selected</h2>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "1.5rem" }}>Please choose a bus stop and route to start live tracking.</p>
            <button className="btn-primary" onClick={() => router.push("/stops")}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>search</span>
              Find a Stop
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main
        className="main-content"
        style={{ overflow: "hidden", height: "100vh", position: "relative" }}
      >
        <TopAppBar title="Live Tracking" />

        {/* ── Waiting overlay ─────────────────────────────────────────────── */}
        {isWaitingForLiveData && (
          <div style={{
            position: "absolute", top: 88, left: "50%",
            transform: "translateX(-50%)", zIndex: 20,
            padding: "0.75rem 1rem", borderRadius: 12,
            background: "rgba(15,23,42,0.85)", color: "white",
            fontWeight: 600, backdropFilter: "blur(8px)",
          }}>
            Waiting for live bus updates...
          </div>
        )}

        {/* ── Map ─────────────────────────────────────────────────────────── */}
        {HAS_MAPBOX_TOKEN ? (
          <div ref={mapContainer} style={{ position: "absolute", inset: 0, top: 64, zIndex: 0 }} />
        ) : (
          <div style={{
            position: "absolute", inset: 0, top: 64, zIndex: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(180deg, #f1f5f9 0%, #e2e8f0 100%)",
            color: "#334155", fontWeight: 700,
          }}>
            Live map unavailable: set NEXT_PUBLIC_MAPBOX_TOKEN
          </div>
        )}

        {/* ── Info panel ───────────────────────────────────────────────────── */}
        <div className="tracking-info-panel glass-panel">
          {/* ── Bus header ──────────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{
              width: 52, height: 52,
              borderRadius: "var(--radius-lg)",
              background: route.color,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 28, color: "white", fontVariationSettings: "'FILL' 1" }}
              >
                directions_bus
              </span>
            </div>

            <div>
              {/* Route number + live status */}
              <p style={{
                fontSize: "0.6875rem", fontWeight: 700,
                color: "var(--color-on-surface-variant)",
                textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2,
              }}>
                Route {liveRoute} ·{" "}
                <span style={{ color: liveStatus === "active" ? "#16a34a" : "#ef4444" }}>
                  {liveStatus === "active" ? "On Time" : "Delayed"}
                </span>
              </p>

              {/* Route name */}
              <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--color-on-surface)" }}>
                {route.name}
              </h3>

              {/* Driver name */}
              <p style={{ fontSize: "0.8125rem", color: "var(--color-on-surface-variant)", marginTop: 2 }}>
                Driver: {liveName}
              </p>
            </div>
          </div>

          {/* ── Stats ───────────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.625rem" }}>
            {[
              { label: "ETA",   value: `${liveEta} min`,       icon: "schedule" },
              { label: "Speed", value: `${liveSpd} km/h`,      icon: "speed"    },
            ].map(({ label, value, icon }) => (
              <div key={label} style={{
                background: "var(--color-surface-container)",
                padding: "0.75rem",
                borderRadius: "var(--radius-lg)",
                textAlign: "center",
              }}>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, color: "var(--color-on-surface-variant)" }}
                >
                  {icon}
                </span>
                <p style={{
                  fontSize: "1rem", fontWeight: 700,
                  color: "var(--color-on-surface)", margin: "0.25rem 0 0.125rem",
                }}>
                  {value}
                </p>
                <p style={{
                  fontSize: "0.625rem", fontWeight: 700,
                  color: "var(--color-on-surface-variant)",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                }}>
                  {label}
                </p>
              </div>
            ))}
          </div>

          {/* ── Stops list ──────────────────────────────────────────────── */}
          <div>
            <p style={{
              fontSize: "0.75rem", fontWeight: 700,
              color: "var(--color-on-surface-variant)",
              textTransform: "uppercase", letterSpacing: "0.08em",
              marginBottom: "0.75rem",
            }}>
              Route Stops
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {route.stops.map((stop, i) => {
                const state = getStopState(i, route.stops.length, prog);
                const label = liveStopLabel(stop, i, route.stops.length, prog, liveBus?.stopEtas);
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: "0.875rem",
                    padding: "0.75rem",
                    background: state === "current"
                      ? `${route.color}12`
                      : "var(--color-surface-container)",
                    borderRadius: "var(--radius-lg)",
                    opacity: state === "passed" ? 0.5 : 1,
                    borderLeft: state === "current"
                      ? `3px solid ${route.color}`
                      : "3px solid transparent",
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: "50%",
                      flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background:
                        state === "passed"  ? "#94a3b8" :
                        state === "current" ? route.color :
                        "var(--color-surface-container-high)",
                    }}>
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: 15,
                          color: state === "upcoming"
                            ? "var(--color-on-surface-variant)"
                            : "white",
                          fontVariationSettings: state === "passed" ? "'FILL' 1" : "'FILL' 0",
                        }}
                      >
                        {state === "passed" ? "check" : "radio_button_unchecked"}
                      </span>
                    </div>

                    <div>
                      <p style={{ fontWeight: 600, fontSize: "0.9375rem", color: "var(--color-on-surface)", marginBottom: 2 }}>
                        {stop.name}
                      </p>
                      <p style={{ fontSize: "0.8125rem", color: "var(--color-on-surface-variant)" }}>
                        {label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function TrackingPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        Loading map…
      </div>
    }>
      <TrackingContent />
    </Suspense>
  );
}

