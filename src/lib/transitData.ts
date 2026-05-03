// Shared route + bus data used across all map pages.

export interface RouteStop {
  name: string;
  coordinates: [number, number];
}

export interface TransitRoute {
  id: string;
  number: string;
  name: string;
  color: string;
  path: [number, number][];
  stops: RouteStop[];
}

export interface BusData {
  id: string;
  number: string;
  routeId: string;
  driverName: string;
  status: "active" | "delayed";
  initProgress: number;
  occupancyPct: number;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function densify(pts: [number, number][], steps = 25): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function interpolate(path: [number, number][], progress: number): [number, number] {
  const t   = Math.max(0, Math.min(1, progress));
  const raw = t * (path.length - 1);
  const lo  = Math.floor(raw);
  const hi  = Math.min(lo + 1, path.length - 1);
  const f   = raw - lo;
  return [path[lo][0] + (path[hi][0] - path[lo][0]) * f,
          path[lo][1] + (path[hi][1] - path[lo][1]) * f];
}

export function getBearing(path: [number, number][], progress: number): number {
  const t  = Math.max(0, Math.min(0.9999, progress));
  const lo = Math.floor(t * (path.length - 1));
  const hi = Math.min(lo + 1, path.length - 1);
  const a  = path[lo], b = path[hi];
  const lat1 = (a[1] * Math.PI) / 180, lat2 = (b[1] * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function splitPath(path: [number, number][], progress: number) {
  const t   = Math.max(0, Math.min(1, progress));
  const idx = Math.floor(t * (path.length - 1));
  const cur = interpolate(path, t);
  return {
    passed: [...path.slice(0, idx + 1), cur] as [number, number][],
    ahead:  [cur, ...path.slice(idx + 1)] as [number, number][],
  };
}

export function getStopState(i: number, total: number, progress: number): "passed" | "current" | "upcoming" {
  const sp = i / Math.max(total - 1, 1);
  if (progress > sp + 0.08) return "passed";
  if (progress > sp - 0.08) return "current";
  return "upcoming";
}

export function stopTimeLabel(i: number, total: number, progress: number): string {
  const state = getStopState(i, total, progress);
  if (state === "passed") return "Departed";
  const sp      = i / Math.max(total - 1, 1);
  const mins    = Math.max(1, Math.round((sp - progress) * 28));
  return state === "current" ? `Arriving ~${mins} min` : `~${mins} min`;
}

// ── Route definitions ─────────────────────────────────────────────────────────

export const TRANSIT_ROUTES: Record<string, TransitRoute> = {
  r882: {
    id: "r882", number: "882", name: "Colombo – Piliyandala", color: "#004ac6",
    path: densify([
      [79.8477, 6.9341], [79.8530, 6.9310], [79.8580, 6.9290],
      [79.8612, 6.9271], [79.8650, 6.9300], [79.8700, 6.9350], [79.8750, 6.9400],
    ]),
    stops: [
      { name: "Fort Station",    coordinates: [79.8477, 6.9341] },
      { name: "Central Station", coordinates: [79.8612, 6.9271] },
      { name: "Market Square",   coordinates: [79.8700, 6.9350] },
      { name: "Piliyandala",     coordinates: [79.8750, 6.9400] },
    ],
  },
  r120: {
    id: "r120", number: "120", name: "Pettah – Kesbewa", color: "#dc2626",
    path: densify([
      [79.8543, 6.9349], [79.8560, 6.9300], [79.8575, 6.9260],
      [79.8610, 6.9230], [79.8650, 6.9200], [79.8680, 6.9170],
    ]),
    stops: [
      { name: "Pettah Market", coordinates: [79.8543, 6.9349] },
      { name: "City Hall",     coordinates: [79.8575, 6.9260] },
      { name: "Nugegoda",      coordinates: [79.8650, 6.9200] },
      { name: "Kesbewa",       coordinates: [79.8680, 6.9170] },
    ],
  },
  r138: {
    id: "r138", number: "138", name: "Fort – Maharagama", color: "#16a34a",
    path: densify([
      [79.8477, 6.9341], [79.8520, 6.9330], [79.8565, 6.9315],
      [79.8610, 6.9300], [79.8660, 6.9275], [79.8715, 6.9255], [79.8770, 6.9240],
    ]),
    stops: [
      { name: "Fort",         coordinates: [79.8477, 6.9341] },
      { name: "Slave Island", coordinates: [79.8565, 6.9315] },
      { name: "Borella",      coordinates: [79.8660, 6.9275] },
      { name: "Maharagama",   coordinates: [79.8770, 6.9240] },
    ],
  },
  r204: {
    id: "r204", number: "204", name: "Borella – Panadura", color: "#d97706",
    path: densify([
      [79.8620, 6.9420], [79.8615, 6.9370], [79.8608, 6.9320],
      [79.8600, 6.9270], [79.8590, 6.9220], [79.8578, 6.9170],
    ]),
    stops: [
      { name: "Borella",    coordinates: [79.8620, 6.9420] },
      { name: "Maradana",   coordinates: [79.8608, 6.9320] },
      { name: "Wellawatte", coordinates: [79.8593, 6.9245] },
      { name: "Panadura",   coordinates: [79.8578, 6.9170] },
    ],
  },
};

// ── Bus fleet ───────────────────────────────���─────────────────────────────────

export const BUSES: Record<string, BusData> = {
  "1": { id: "1", number: "882", routeId: "r882", driverName: "K. Perera",      status: "active",  initProgress: 0.06, occupancyPct: 62 },
  "2": { id: "2", number: "120", routeId: "r120", driverName: "S. Fernando",    status: "delayed", initProgress: 0.22, occupancyPct: 78 },
  "3": { id: "3", number: "138", routeId: "r138", driverName: "R. Silva",       status: "active",  initProgress: 0.13, occupancyPct: 45 },
  "4": { id: "4", number: "204", routeId: "r204", driverName: "M. Jayawardena", status: "active",  initProgress: 0.38, occupancyPct: 55 },
  "5": { id: "5", number: "882", routeId: "r882", driverName: "D. Bandara",     status: "active",  initProgress: 0.54, occupancyPct: 83 },
  "6": { id: "6", number: "138", routeId: "r138", driverName: "P. Kumara",      status: "active",  initProgress: 0.67, occupancyPct: 38 },
};

// ── API fetch helpers ─────────────────────────────────────────────────────────

export interface LiveBus {
  id: string;
  status: string;
  route_id: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Fetch all routes as GeoJSON from the backend; falls back to static data. */
export async function fetchAllRoutesFromApi(): Promise<TransitRoute[]> {
  try {
    const summaries: { id: number; name: string }[] = await fetch('/api/routes').then(r => r.json());
    const routes = await Promise.all(
      summaries.map(async (s) => {
        const geojson = await fetch(`/api/routes/${s.id}`).then(r => r.json());
        const lineFeature = geojson.features?.find(
          (f: { properties: { feature_type: string } }) => f.properties?.feature_type === 'route'
        );
        const stopFeatures: { properties: { name: string; order: number }; geometry: { coordinates: [number, number] } | null }[] =
          geojson.features?.filter(
            (f: { properties: { feature_type: string } }) => f.properties?.feature_type === 'stop'
          ) ?? [];
        if (!lineFeature) return null;
        const coords: [number, number][] = lineFeature.geometry.coordinates;
        const stops: RouteStop[] = stopFeatures
          .sort((a, b) => a.properties.order - b.properties.order)
          .map((f) => ({ name: f.properties.name, coordinates: f.geometry?.coordinates ?? [0, 0] }));
        return { id: `r${s.id}`, number: String(s.id), name: s.name, color: '#004ac6', path: coords, stops } satisfies TransitRoute;
      })
    );
    return routes.filter(Boolean) as TransitRoute[];
  } catch {
    return Object.values(TRANSIT_ROUTES);
  }
}

/** Fetch live bus positions; returns empty array on error. */
export async function fetchLiveBusesFromApi(): Promise<LiveBus[]> {
  try {
    const data = await fetch('/api/buses/live', { cache: 'no-store' }).then(r => r.json());
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
