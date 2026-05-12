import type {
  SocketClient,
  SocketEventHandler,
  SocketEventMap,
  StopEta,
} from './socketTypes';

export type BusLocation = {
  busId: string;
  routeId: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  timestamp: number;
  occupancy: 'low' | 'medium' | 'high';
  status: 'active' | 'delayed';
  driverName: string;
  eta: number;
  stopEtas?: StopEta[];
};

type Listeners = Map<string, Set<(data: unknown) => void>>;

class SocketService {
  private ws: WebSocket | null = null;
  private listeners: Listeners = new Map();
  private url = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnects = 5;

  connect(url = process.env.NEXT_PUBLIC_SOCKET_URL || 'ws://localhost:8004/v1/live') {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) return;
    this.url = url;
    this._open();
  }

  private _open() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[Socket] Connected:', this.url);
      this.reconnectAttempts = 0;
      this._dispatch('connect', undefined);
    };

    this.ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string);

        if (raw.event === 'eta_update') {
          const etaSec = raw.eta_seconds != null ? Number(raw.eta_seconds) : null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stopEtas: StopEta[] = (raw.stop_etas ?? []).map((s: any) => ({
            stopId:     Number(s.stopId ?? s.stop_id ?? 0),
            stopName:   (s.stopName ?? s.stop_name ?? null) as string | null,
            etaSeconds: Number(s.etaSeconds ?? s.eta_seconds ?? 0),
          }));
          this._dispatch('bus:eta', {
            busId:    String(raw.busId ?? raw.bus_id ?? ''),
            eta:      etaSec != null ? Math.max(1, Math.round(etaSec / 60)) : Number(raw.eta ?? 0),
            stopEtas,
          });
          return;
        }

        const location: BusLocation = {
          busId:      String(raw.busId ?? raw.bus_id ?? ''),
          routeId:    String(raw.routeId ?? raw.route_id ?? ''),
          lat:        Number(raw.lat ?? 0),
          lng:        Number(raw.lon ?? raw.lng ?? 0),
          speed:      Number(raw.speed ?? 0),
          heading:    Number(raw.heading ?? 0),
          timestamp:  Number(raw.timestamp ?? Date.now()),
          occupancy:  raw.occupancy ?? 'low',
          status:     raw.status ?? 'active',
          driverName: raw.driverName ?? 'Unknown',
          eta:        Number(raw.eta ?? raw.eta_seconds ?? 0),
        };
        this._dispatch('bus:location', location);
      } catch (e) {
        console.error('[Socket] Parse error:', e);
      }
    };

    this.ws.onerror = () => {
      console.error('[Socket] Error');
      this._dispatch('connect_error', new Error('WebSocket error'));
    };

    this.ws.onclose = (e) => {
      console.warn('[Socket] Disconnected:', e.reason);
      this._dispatch('disconnect', e.reason);
      this._scheduleReconnect();
    };
  }

  private _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnects) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`[Socket] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnects})`);
      this._open();
      this._dispatch('reconnect', this.reconnectAttempts);
    }, delay);
  }

  on<K extends keyof SocketEventMap>(event: K, handler: SocketEventHandler<K>) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler as (data: unknown) => void);
  }

  off<K extends keyof SocketEventMap>(event: K, handler?: SocketEventHandler<K>) {
    if (!handler) { this.listeners.delete(event); return; }
    this.listeners.get(event)?.delete(handler as (data: unknown) => void);
  }

  emit(event: string, data?: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    } else {
      console.warn(`[Socket] Cannot emit "${event}" — not connected`);
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private _dispatch(event: string, data: unknown) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }
}

export const socketService: SocketClient = new SocketService();
