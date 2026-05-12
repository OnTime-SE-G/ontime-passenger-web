import { create } from 'zustand';
import type { BusLocation } from '@/lib/socket/socketAdapter';

/**
 * Connection status type
 */
type Status = 'disconnected' | 'connecting' | 'connected' | 'error';

import type { StopEta } from '@/lib/socket/socketTypes';

interface BusStore {
  buses: Map<string, BusLocation>;
  connectionStatus: Status;
  lastUpdateAt: number;

  updateBus: (bus: BusLocation) => void;
  patchEta: (busId: string, eta: number, stopEtas?: StopEta[]) => void;
  setStatus: (s: Status) => void;
  clearBuses: () => void;

  getBus: (id: string) => BusLocation | undefined;
  getAllBuses: () => BusLocation[];
}

/**
 * Zustand store for real-time bus tracking
 */
export const useBusStore = create<BusStore>((set, get) => ({
  buses: new Map(),
  connectionStatus: 'disconnected',
  lastUpdateAt: 0,

  /**
   * Update or insert a bus
   */
  updateBus: (bus) => {
    if (!bus?.busId) {
      console.warn('[BusStore] Invalid bus data:', bus);
      return;
    }

    set(({ buses }) => {
      const existing = buses.get(bus.busId);

      // Avoid unnecessary updates if nothing changed
      if (
        existing &&
        existing.lat === bus.lat &&
        existing.lng === bus.lng &&
        existing.speed === bus.speed &&
        existing.heading === bus.heading &&
        existing.occupancy === bus.occupancy &&
        existing.status   === bus.status   &&   // ← add
        existing.eta      === bus.eta           // ← add
      ) {
        return {}; // no state change → no re-render
      }

      const next = new Map(buses);
      // Preserve a non-zero ETA that patchEta already set; fleet:live messages
      // come from Flink which doesn't compute ETA and always sends eta:0.
      const eta = bus.eta || existing?.eta || 0;
      next.set(bus.busId, { ...bus, eta });

      return {
        buses: next,
        lastUpdateAt: Date.now(),
      };
    });
  },

  patchEta: (busId, eta, stopEtas) =>
    set(({ buses }) => {
      const existing = buses.get(busId);
      if (!existing) return {};
      const next = new Map(buses);
      next.set(busId, {
        ...existing,
        eta,
        ...(stopEtas !== undefined && { stopEtas }),
      });
      return { buses: next, lastUpdateAt: Date.now() };
    }),

  /**
   * Update connection status (avoid redundant updates)
   */
  setStatus: (connectionStatus) =>
    set((state) =>
      state.connectionStatus === connectionStatus
        ? state
        : { connectionStatus }
    ),

  /**
   * Clear all buses (useful on logout / reset)
   */
  clearBuses: () =>
    set({
      buses: new Map(),
      lastUpdateAt: 0,
    }),

  /**
   * Get a single bus
   */
  getBus: (id) => get().buses.get(id),

  /**
   * Get all buses as array
   */
  getAllBuses: () => Array.from(get().buses.values()),
}));