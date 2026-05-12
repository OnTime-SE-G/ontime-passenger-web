"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import TopAppBar from "@/components/TopAppBar";
import { fetchRoutes, fetchBusesByRoute, fetchAllTransitRoutes } from "@/services/api";
import type { ApiTransitRoute } from "@/services/api";

interface BusRoute {
  id: string;
  number: string;
  name: string;
  destination: string;
  status: "active" | "delayed";
  eta: string;
  etaColor: string;
  type: string;
}

const SORT_OPTIONS = ["Shortest ETA", "Distance", "Route Number"];

function NearbyBusesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeParam = searchParams.get("route");
  const stopParam = searchParams.get("stop");
  const routeId = searchParams.get("routeId");         // DB route id — for fleet bus fetch
  const routeIdsParam = searchParams.get("routeIds");  // comma list — from home page search

  const [allRoutes, setAllRoutes] = useState<BusRoute[]>([]);
  const [transitRoutes, setTransitRoutes] = useState<Record<string, ApiTransitRoute>>({});
  const [destinationFilter, setDestinationFilter] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sortOption, setSortOption] = useState(0);
  const destInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchAllTransitRoutes()
      .then(setTransitRoutes)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const mapRoutes = (data: import("@/services/api").ApiRoute[]): BusRoute[] =>
      data.map((r) => {
        const parts = r.name.split(" - ");
        return {
          id: String(r.id),
          number: r.route_number ?? String(r.id),
          name: r.name,
          destination: r.destination ?? parts[1]?.trim() ?? parts[0] ?? r.name,
          status: "active" as const,
          eta: "Live",
          etaColor: "#16a34a",
          type: "Bus",
        };
      });

    if (routeId) {
      fetchBusesByRoute(routeId)
        .then((buses) => {
          if (buses.length > 0) {
            setAllRoutes(
              buses.map((b) => ({
                id: b.id,
                number: b.fleet_code,
                name: `Bus ${b.fleet_code} · ${b.plate_number}`,
                destination: routeParam ? `Route ${routeParam}` : "Route service",
                status: (b.status === "active" ? "active" : "delayed") as "active" | "delayed",
                eta: "Live",
                etaColor: "#16a34a",
                type: `Capacity: ${b.capacity ?? "--"}`,
              }))
            );
            return;
          }
          // No fleet buses assigned — fall back to the route list filtered to this route
          fetchRoutes()
            .then((data) => {
              const mapped = mapRoutes(data);
              const filtered = mapped.filter(
                (r) => r.id === routeId || (routeParam && r.number === routeParam)
              );
              setAllRoutes(filtered.length > 0 ? filtered : mapped);
            })
            .catch(() => {});
        })
        .catch(() => {});
    } else {
      fetchRoutes()
        .then((data) => setAllRoutes(mapRoutes(data)))
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  // Collect stop names from all transit routes for autocomplete
  const stopSuggestions = useMemo(() => {
    if (!destinationFilter.trim()) return [];
    const query = destinationFilter.toLowerCase();
    const names = new Set<string>();
    Object.values(transitRoutes).forEach((r) => {
      r.stops?.forEach((s) => {
        if (s.name.toLowerCase().includes(query)) names.add(s.name);
      });
    });
    return Array.from(names).slice(0, 6);
  }, [destinationFilter, transitRoutes]);

  // Filter buses by route parameter — skip when routeId is set because the
  // fleet API already returned only buses for that route.
  let filteredBuses = (routeParam && !routeId)
    ? allRoutes.filter((bus) => bus.number === routeParam)
    : allRoutes;

  // When home page search returned specific route IDs, filter to those
  if (routeIdsParam && !routeId) {
    const ids = new Set(routeIdsParam.split(","));
    filteredBuses = allRoutes.filter((bus) => ids.has(bus.id));
  }

  // Filter by destination — match against actual route stops, fall back to destination string
  if (destinationFilter.trim()) {
    const query = destinationFilter.toLowerCase();
    filteredBuses = filteredBuses.filter((bus) => {
      // When fleet buses are shown, all belong to routeId — check that route's stops
      const trId = routeId ?? bus.id;
      const tr = transitRoutes[trId];
      if (tr?.stops?.length) {
        return tr.stops.some((s) => s.name.toLowerCase().includes(query));
      }
      // Fallback: match against destination string
      return bus.destination.toLowerCase().includes(query);
    });
  }

  // Sort buses
  const sortedBuses = [...filteredBuses].sort((a, b) => {
    if (sortOption === 0 || sortOption === 1) {
      const ea = parseInt(a.eta);
      const eb = parseInt(b.eta);
      if (isNaN(ea) && isNaN(eb)) return 0;
      if (isNaN(ea)) return 1;
      if (isNaN(eb)) return -1;
      return ea - eb;
    } else {
      return a.number.localeCompare(b.number, undefined, { numeric: true });
    }
  });

  const handleSelectBus = (busId: string) => {
    if (routeId) {
      // Fleet bus from stop-details: use routeParam (the real route number), not bus.number (fleet_code)
      router.push(`/tracking?bus=${busId}&route=${routeParam ?? ""}&routeDbId=${routeId}`);
    } else {
      // Route from route list: busId IS the route DB id, bus.number is the route number
      const bus = allRoutes.find((b) => b.id === busId);
      const routeNum = bus?.number ?? busId;
      router.push(`/tracking?route=${routeNum}&routeDbId=${busId}`);
    }
  };
  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        <TopAppBar showSearch />

        <div
          className="page-enter"
          style={{
            marginTop: "64px",
            minHeight: "calc(100vh - 64px)",
            backgroundColor: "var(--color-surface-container-low)",
            padding: "2rem",
            boxSizing: "border-box",
          }}
        >
          {/* Breadcrumb */}
          {(routeParam || stopParam) && (
            <div
              style={{
                marginBottom: "1.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.875rem",
                color: "var(--color-on-surface-variant)",
              }}
            >
              <span>{stopParam || "Stop"}</span>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                chevron_right
              </span>
              <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>
                Route {routeParam || "All"}
              </span>
            </div>
          )}

          {/* Header Row */}
          <div
            style={{
              marginBottom: "1.5rem",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: "2rem",
                  fontWeight: 700,
                  color: "var(--color-on-surface)",
                  letterSpacing: "-0.015em",
                  marginBottom: "0.375rem",
                }}
              >
                {routeParam ? `Route ${routeParam} Buses` : "Active Routes"}
              </h1>
              <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.9375rem" }}>
                {sortedBuses.length} {sortedBuses.length === 1 ? "bus" : "buses"} available
              </p>
            </div>

            {/* Sort Chips */}
            <div className="sort-chips">
              {SORT_OPTIONS.map((opt, i) => (
                <button
                  key={opt}
                  onClick={() => setSortOption(i)}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "var(--radius-full)",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    backgroundColor:
                      i === sortOption
                        ? "var(--color-secondary-container)"
                        : "var(--color-surface-container-high)",
                    color:
                      i === sortOption
                        ? "var(--color-on-secondary-container)"
                        : "var(--color-on-surface)",
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Destination Filter */}
          <div style={{ position: "relative", marginBottom: "1.5rem" }}>
            <div
              className="card"
              style={{
                padding: "1.25rem",
                display: "flex",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px", color: "var(--color-outline)" }}
              >
                location_on
              </span>
              <input
                ref={destInputRef}
                type="text"
                value={destinationFilter}
                onChange={(e) => {
                  setDestinationFilter(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Filter by drop-off stop (e.g., Piliyandala, Maharagama)"
                className="input-field"
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  fontSize: "0.9375rem",
                  padding: 0,
                }}
              />
              {destinationFilter && (
                <button
                  onClick={() => { setDestinationFilter(""); setShowSuggestions(false); }}
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    backgroundColor: "var(--color-surface-container)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "18px", color: "var(--color-on-surface)" }}
                  >
                    close
                  </span>
                </button>
              )}
            </div>

            {/* Stop suggestions dropdown */}
            {showSuggestions && stopSuggestions.length > 0 && (
              <div
                className="card"
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  zIndex: 50,
                  padding: "0.5rem 0",
                  boxShadow: "var(--shadow-elevated)",
                  borderRadius: "var(--radius-lg)",
                  overflow: "hidden",
                }}
              >
                {stopSuggestions.map((name) => (
                  <button
                    key={name}
                    onMouseDown={() => {
                      setDestinationFilter(name);
                      setShowSuggestions(false);
                    }}
                    style={{
                      width: "100%",
                      padding: "0.625rem 1.25rem",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      fontSize: "0.9375rem",
                      color: "var(--color-on-surface)",
                      background: "none",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "var(--color-surface-container)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "none";
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "16px", color: "var(--color-outline)", flexShrink: 0 }}
                    >
                      place
                    </span>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bus List */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {sortedBuses.length === 0 ? (
              <div
                className="card"
                style={{
                  padding: "3rem 2rem",
                  textAlign: "center",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: "64px",
                    color: "var(--color-outline-variant)",
                    marginBottom: "1rem",
                  }}
                >
                  search_off
                </span>
                <h3
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    color: "var(--color-on-surface)",
                    marginBottom: "0.5rem",
                  }}
                >
                  No Buses Found
                </h3>
                <p style={{ color: "var(--color-on-surface-variant)" }}>
                  Try adjusting your filter to see more results.
                </p>
              </div>
            ) : (
              sortedBuses.map((route) => (
              <div
                key={route.id}
                className="card bus-card-row"
                onClick={() => handleSelectBus(route.id)}
                style={{ opacity: route.status === "delayed" ? 0.9 : 1 }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-elevated)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = "";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "";
                }}
              >
                {/* Left: Route Info */}
                <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                  {/* Route Number Badge */}
                  <div
                    style={{
                      width: "64px",
                      height: "64px",
                      borderRadius: "var(--radius-lg)",
                      backgroundColor:
                        route.status === "active"
                          ? "rgba(37, 99, 235, 0.15)"
                          : "var(--color-surface-container-high)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.25rem",
                      fontWeight: 700,
                      color:
                        route.status === "active"
                          ? "var(--color-primary)"
                          : "var(--color-on-surface-variant)",
                      flexShrink: 0,
                    }}
                  >
                    {route.number}
                  </div>

                  <div>
                    {/* Route Name + Status Badge */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        marginBottom: "0.375rem",
                      }}
                    >
                      <h3
                        style={{
                          fontSize: "1.125rem",
                          fontWeight: 700,
                          color: "var(--color-on-surface)",
                        }}
                      >
                        {route.name}
                      </h3>
                      <span
                        className={`badge ${route.status === "active" ? "badge-active" : "badge-delayed"}`}
                      >
                        <span
                          style={{
                            width: "6px",
                            height: "6px",
                            borderRadius: "50%",
                            backgroundColor:
                              route.status === "active" ? "#16a34a" : "#ef4444",
                            display: "inline-block",
                          }}
                        />
                        {route.status === "active" ? "Active" : "Delayed"}
                      </span>
                    </div>

                    {/* ETA + Bus Type */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        color: "var(--color-on-surface-variant)",
                        fontSize: "0.875rem",
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                        schedule
                      </span>
                      <span>
                        ETA:{" "}
                        <strong style={{ color: route.etaColor }}>{route.eta}</strong>
                      </span>
                      <span
                        style={{
                          width: "3px",
                          height: "3px",
                          borderRadius: "50%",
                          backgroundColor: "var(--color-outline-variant)",
                          margin: "0 0.25rem",
                        }}
                      />
                      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                        directions_bus
                      </span>
                      <span>{route.type}</span>
                    </div>
                  </div>
                </div>

                {/* CTA */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleSelectBus(route.id); }}
                  className="btn-primary bus-card-cta"
                  style={{
                    width: "auto",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.9375rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>directions_bus</span>
                  Track Bus
                </button>
              </div>
            ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function NearbyBusesPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <NearbyBusesContent />
    </Suspense>
  );
}
