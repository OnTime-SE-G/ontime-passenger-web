'use client';

import { useEffect, useRef, useCallback } from 'react';
import { socket, type BusLocation } from '@/lib/socket/socketAdapter';
import type { BusEtaUpdate } from '@/lib/socket/socketTypes';
import { useBusStore } from '@/store/busStore';

/**
 * Hook: useBusTracking
 *
 * Connects to socket (singleton) and syncs real-time bus data
 * into global Zustand store.
 *
 * ⚠️ Important:
 * - Assumes socket is shared globally (DO NOT aggressively disconnect)
 * - Safe for React Strict Mode
 */
export function useBusTracking() {
  const { updateBus, patchEta, setStatus, buses, connectionStatus } = useBusStore();

  // Prevent double execution in React Strict Mode (dev)
  const mounted = useRef(false);

  /**
   * Memoized handlers (required for correct .off cleanup)
   */
  const onLocation = useCallback(
    (data: BusLocation) => {
      updateBus(data);
    },
    [updateBus]
  );

  const onEta = useCallback(
    (data: BusEtaUpdate) => {
      patchEta(data.busId, data.eta, data.stopEtas);
    },
    [patchEta]
  );

  const onConnect = useCallback(() => {
    console.log('[BusTracking] Connected');
    setStatus('connected');
  }, [setStatus]);

  const onDisconnect = useCallback(() => {
    console.warn('[BusTracking] Disconnected');
    setStatus('disconnected');
  }, [setStatus]);

  const onError = useCallback(() => {
    console.error('[BusTracking] Connection error');
    setStatus('disconnected');
  }, [setStatus]);

  useEffect(() => {
    // Prevent double mount in Strict Mode
    if (mounted.current) return;
    mounted.current = true;

    console.log('[BusTracking] Initializing...');

    setStatus('connecting');

    /**
     * Connect only if not already connected
     */
    if (!socket.isConnected) {
      socket.connect();
    }

    /**
     * Register listeners
     */
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onError);
    socket.on('reconnect', onConnect); // 🔥 handle reconnection
    socket.on('bus:location', onLocation);
    socket.on('bus:eta', onEta);

    /**
     * Cleanup
     */
    return () => {
      console.log('[BusTracking] Cleaning up...');

      socket.off('bus:location', onLocation);
      socket.off('bus:eta', onEta);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onError);
      socket.off('reconnect', onConnect);

      /**
       * ⚠️ IMPORTANT DESIGN DECISION:
       * Do NOT disconnect here if socket is shared globally
       *
       * If you REALLY want per-component sockets:
       * → then uncomment below
       */
      // socket.disconnect();

      mounted.current = false;
    };

    /**
     * Intentionally empty dependency array:
     * - socket is singleton
     * - handlers are stable via useCallback
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Return reactive state
   */
  return {
    buses,
    connectionStatus,
    updateBus,
  };
}