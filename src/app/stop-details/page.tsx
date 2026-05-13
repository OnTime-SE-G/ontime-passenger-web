"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import TopAppBar from "@/components/TopAppBar";
import { fetchStopRoutes } from "@/services/api";

interface Route {
  id: string;
  number: string;
  name: string;
  frequency: string;
}

function StopDetailsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stopId = searchParams.get("id") || "1";
  const stopName = searchParams.get("name") || "Central Station";
  const routeIdsParam = searchParams.get("routeIds") ?? "";

  const routeIdSet = useMemo(() => {
    const ids = routeIdsParam.split(",").map((id) => id.trim()).filter(Boolean);
    return new Set(ids);
  }, [routeIdsParam]);

  const [routes, setRoutes] = useState<Route[]>([]);

  useEffect(() => {
    fetchStopRoutes(stopId)
      .then((data) => {
        const mapped = data.map((r) => ({
          id: String(r.id),
          number: r.route_number ?? String(r.id),
          name: r.name,
          frequency: "Check live board",
        }));
        const filtered = routeIdSet.size > 0
          ? mapped.filter((r) => routeIdSet.has(r.id))
          : mapped;
        setRoutes(filtered);
      })
      .catch(() => {});
  }, [routeIdSet, stopId]);

  const handleRouteSelect = (routeNumber: string, routeDbId: string) => {
    router.push(`/nearby?route=${routeNumber}&routeId=${routeDbId}&stop=${stopName}`);
  };

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        <TopAppBar title="Stop Details" />

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
          {/* Back Button */}
          <button
            onClick={() => router.back()}
            className="btn-secondary"
            style={{
              marginBottom: "1.5rem",
              display: "inline-flex",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              arrow_back
            </span>
            Back to Map
          </button>

          {/* Stop Header */}
          <div
            className="card-lg stop-header"
            style={{
              padding: "2rem",
              marginBottom: "2rem",
              display: "flex",
              alignItems: "center",
              gap: "1.5rem",
            }}
          >
            <div
              style={{
                width: "80px",
                height: "80px",
                borderRadius: "var(--radius-xl)",
                background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-container))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: "40px",
                  color: "white",
                  fontVariationSettings: "'FILL' 1",
                }}
              >
                place
              </span>
            </div>
            <div>
              <p
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "var(--color-on-surface-variant)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: "0.375rem",
                }}
              >
                Bus Stop
              </p>
              <h1
                style={{
                  fontSize: "2rem",
                  fontWeight: 700,
                  color: "var(--color-on-surface)",
                  letterSpacing: "-0.015em",
                  marginBottom: "0.5rem",
                }}
              >
                {stopName}
              </h1>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  fontSize: "0.9375rem",
                  color: "var(--color-on-surface-variant)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                    route
                  </span>
                  {routes.length} routes available
                </span>
                <span
                  style={{
                    width: "4px",
                    height: "4px",
                    borderRadius: "50%",
                    backgroundColor: "var(--color-outline-variant)",
                  }}
                />
                <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  <div className="live-dot" style={{ width: "8px", height: "8px" }} />
                  Live updates
                </span>
              </div>
            </div>
          </div>

          {/* Routes Section */}
          <div style={{ marginBottom: "1.5rem" }}>
            <h2
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "var(--color-on-surface)",
                marginBottom: "1rem",
              }}
            >
              Routes Passing Through
            </h2>
            <p
              style={{
                color: "var(--color-on-surface-variant)",
                marginBottom: "1.5rem",
              }}
            >
              Select a route to see available buses
            </p>
          </div>

          {/* Route Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))",
              gap: "1rem",
            }}
          >
            {routes.map((route) => (
              <button
                key={route.id}
                onClick={() => handleRouteSelect(route.number, route.id)}
                className="card"
                style={{
                  padding: "1.5rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "1.25rem",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "var(--radius-lg)",
                    backgroundColor: "rgba(37, 99, 235, 0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    color: "var(--color-primary)",
                    flexShrink: 0,
                  }}
                >
                  {route.number}
                </div>
                <div style={{ flex: 1 }}>
                  <h3
                    style={{
                      fontSize: "1.125rem",
                      fontWeight: 700,
                      color: "var(--color-on-surface)",
                      marginBottom: "0.375rem",
                    }}
                  >
                    {route.name}
                  </h3>
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
                    {route.frequency}
                  </div>
                </div>
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: "24px",
                    color: "var(--color-on-surface-variant)",
                  }}
                >
                  arrow_forward
                </span>
              </button>
            ))}
          </div>

          {/* Empty State */}
          {routes.length === 0 && (
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
                directions_bus_filled
              </span>
              <h3
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: "var(--color-on-surface)",
                  marginBottom: "0.5rem",
                }}
              >
                No Routes Available
              </h3>
              <p style={{ color: "var(--color-on-surface-variant)" }}>
                There are currently no bus routes at this stop.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function StopDetailsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StopDetailsContent />
    </Suspense>
  );
}
