import { useEffect, useRef, useState } from 'react';
import { CONNECTION_STATE_CHANGE, ConnectionState } from 'aws-amplify/api';
import { Hub } from 'aws-amplify/utils';
import {
  Category,
  PriorityBand,
  ReportStatus,
  Urgency,
  type PublicReport,
} from '@crisismap/shared';

import { client } from './amplify';

/** Browser-visible lifecycle of the shared AppSync real-time connection. */
export type RealtimeConnectionState =
  'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

const REPORT_STATUSES = new Set<string>(Object.values(ReportStatus));
const CATEGORIES = new Set<string>(Object.values(Category));
const URGENCIES = new Set<string>(Object.values(Urgency));
const PRIORITY_BANDS = new Set<string>(Object.values(PriorityBand));

function optionalEnum<T extends string>(value: unknown, allowed: ReadonlySet<string>): T | null {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Validate the custom subscription payload before it crosses into a UI read
 * model. The channel is structurally PII-free, but its custom type uses strings
 * for domain enums, so a malformed/internal ADMIN publish is rejected rather
 * than treated as a valid lifecycle update.
 */
export function parseReportUpdate(value: unknown): PublicReport | null {
  if (typeof value !== 'object' || value === null) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.reportId !== 'string' ||
    typeof event.status !== 'string' ||
    !REPORT_STATUSES.has(event.status)
  ) {
    return null;
  }

  return {
    reportId: event.reportId,
    status: event.status as ReportStatus,
    category: optionalEnum<Category>(event.category, CATEGORIES),
    urgency: optionalEnum<Urgency>(event.urgency, URGENCIES),
    priorityScore: optionalNumber(event.priorityScore),
    priorityBand: optionalEnum<PriorityBand>(event.priorityBand, PRIORITY_BANDS),
    summary: optionalString(event.summary),
    lat: optionalNumber(event.lat),
    lng: optionalNumber(event.lng),
    geohash: optionalString(event.geohash),
    geohashPrefix: optionalString(event.geohashPrefix),
    regionId: optionalString(event.regionId),
    createdAt: optionalString(event.createdAt),
    updatedAt: optionalString(event.updatedAt),
  };
}

export interface ReportUpdateSubscriptionOptions {
  /** Do not open a User Pool subscription until the route has authenticated. */
  enabled: boolean;
  /** Reconcile one delivered redacted event into the surface's local read model. */
  onUpdate: (report: PublicReport) => void | Promise<void>;
  /** Reload a durable snapshot after a connection gap may have dropped events. */
  onReconnect: () => void | Promise<void>;
}

/**
 * Own the authenticated `onReportUpdate` subscription and connection lifecycle.
 * Amplify reconnects the WebSocket; after a disruption this hook asks the
 * consumer to reload its durable snapshot so missed events cannot leave stale
 * operational state behind.
 */
export function useReportUpdates({
  enabled,
  onUpdate,
  onReconnect,
}: ReportUpdateSubscriptionOptions): RealtimeConnectionState {
  const [connection, setConnection] = useState<RealtimeConnectionState>('idle');
  const onUpdateRef = useRef(onUpdate);
  const onReconnectRef = useRef(onReconnect);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    if (!enabled) {
      setConnection('idle');
      return;
    }

    let active = true;
    let connectedOnce = false;
    let missedWindow = false;
    setConnection('connecting');

    const run = (callback: () => void | Promise<void>) => {
      void Promise.resolve()
        .then(callback)
        .catch(() => {
          if (active) setConnection('error');
        });
    };

    const cancelHubListener = Hub.listen('api', ({ payload, source }) => {
      if (source !== 'PubSub' || payload.event !== CONNECTION_STATE_CHANGE) return;
      const next = (payload.data as { connectionState?: ConnectionState } | undefined)
        ?.connectionState;

      if (next === ConnectionState.Connected) {
        const reconcile = connectedOnce && missedWindow;
        connectedOnce = true;
        missedWindow = false;
        setConnection('connected');
        if (reconcile) run(() => onReconnectRef.current());
        return;
      }
      if (next === ConnectionState.ConnectedPendingKeepAlive) {
        setConnection('connected');
        return;
      }
      if (next === ConnectionState.Connecting) {
        setConnection('connecting');
        return;
      }
      if (
        next === ConnectionState.ConnectionDisrupted ||
        next === ConnectionState.ConnectionDisruptedPendingNetwork ||
        next === ConnectionState.ConnectedPendingNetwork ||
        next === ConnectionState.ConnectedPendingDisconnect ||
        next === ConnectionState.Disconnected
      ) {
        missedWindow ||= connectedOnce;
        setConnection('disconnected');
      }
    });

    const subscription = client.subscriptions.onReportUpdate().subscribe({
      next: (event) => {
        const report = parseReportUpdate(event);
        if (!report) {
          setConnection('error');
          return;
        }
        connectedOnce = true;
        setConnection('connected');
        run(() => onUpdateRef.current(report));
      },
      error: () => {
        if (active) setConnection('error');
      },
      complete: () => {
        if (active) setConnection('disconnected');
      },
    });

    return () => {
      active = false;
      subscription.unsubscribe();
      cancelHubListener();
    };
  }, [enabled]);

  return connection;
}
