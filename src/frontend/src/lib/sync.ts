/**
 * SyncService — polls the backend every 5 seconds and keeps IndexedDB fresh.
 * Uses Page Visibility API to pause when tab is hidden.
 * Uses BroadcastChannel to deduplicate syncs across multiple tabs.
 */

import { createActorWithConfig } from "@caffeineai/core-infrastructure";
import { createActor } from "../backend";
import type { backendInterface } from "../backend.d.ts";
import {
  type AttendanceRecord,
  type PermissionRecord,
  type SettingsRecord,
  type WorkerRecord,
  dbPutAttendance,
  dbPutPermission,
  dbPutSettings,
  dbPutTiming,
  dbPutWorker,
} from "./db";

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

type SyncUpdateCallback = (status: SyncStatus) => void;
type RefreshCallback = () => void;

const POLL_INTERVAL_MS = 5000;
const CHANNEL_NAME = "attendance-sync";

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastVersion: bigint = BigInt(-1);
let currentCompanyId: string | null = null;
let _syncStatus: SyncStatus = "idle";
let _actor: backendInterface | null = null;
let _actorLoading = false;

const subscribers: Set<SyncUpdateCallback> = new Set();
const refreshCallbacks: Set<RefreshCallback> = new Set();
let broadcastChannel: BroadcastChannel | null = null;
let isLeader = true;

function notifySubscribers(status: SyncStatus) {
  _syncStatus = status;
  for (const cb of subscribers) {
    cb(status);
  }
}

function setupBroadcastChannel() {
  if (typeof BroadcastChannel === "undefined") {
    isLeader = true;
    return;
  }
  broadcastChannel?.close();
  broadcastChannel = new BroadcastChannel(CHANNEL_NAME);

  broadcastChannel.onmessage = (
    e: MessageEvent<{ type: string; status?: string; version?: string }>,
  ) => {
    if (e.data.type === "sync-done" && e.data.status) {
      notifySubscribers(e.data.status as SyncStatus);
      if (e.data.version) {
        lastVersion = BigInt(e.data.version);
      }
    } else if (e.data.type === "leader-claim") {
      isLeader = false;
    }
  };

  // Claim leadership
  isLeader = true;
  try {
    broadcastChannel.postMessage({ type: "leader-claim" });
  } catch {
    // ignore
  }
}

async function getBackendActor(): Promise<backendInterface | null> {
  if (_actor) return _actor;
  if (_actorLoading) return null;
  _actorLoading = true;
  try {
    const a = await createActorWithConfig(createActor);
    _actor = a as backendInterface;
    return _actor;
  } catch {
    return null;
  } finally {
    _actorLoading = false;
  }
}

async function performSync(companyId: string): Promise<void> {
  if (!isLeader) return;

  notifySubscribers("syncing");

  const a = await getBackendActor();
  if (!a) {
    notifySubscribers("error");
    return;
  }

  try {
    const newVersion = await a.getSyncVersion(companyId);
    if (newVersion === lastVersion) {
      notifySubscribers("synced");
      return;
    }

    // Version changed — fetch fresh data
    const [settings, timing, workers, allAttendance, allPermissions] =
      await Promise.all([
        a.getCompanySettings(companyId),
        a.getCompanyTiming(companyId),
        a.listWorkers(companyId),
        a.getAllAttendance(companyId),
        a.getAllPermissions(companyId),
      ]);

    // Hydrate settings
    if (settings) {
      const idbSettings: SettingsRecord = {
        id: `settings-${companyId}`,
        companyId: settings.companyId,
        latitude: settings.latitude,
        longitude: settings.longitude,
        radius: settings.radius,
        wifiSsid: settings.wifiSsid,
        updatedAt: Number(settings.updatedAt),
      };
      await dbPutSettings(idbSettings);
    }

    // Hydrate timing
    if (timing) {
      await dbPutTiming({
        id: `timing-${companyId}`,
        startTime: timing.startTime,
        endTime: timing.endTime,
        gracePeriodMinutes: Number(timing.gracePeriodMinutes),
        updatedAt: Number(timing.updatedAt),
      });
    }

    // Hydrate workers
    for (const w of workers) {
      const idbWorker: WorkerRecord = {
        id: w.id,
        companyId: w.companyId,
        name: w.name,
        department: w.department,
        phone: w.phone,
        faceEmbeddings: new Float32Array(w.faceEmbeddings.buffer),
        enrolledAt: Number(w.enrolledAt),
      };
      await dbPutWorker(idbWorker);
    }

    // Hydrate attendance
    for (const record of allAttendance) {
      const idbAtt: AttendanceRecord = {
        id: record.id,
        companyId: record.companyId,
        workerId: record.workerId,
        date: record.date,
        checkIn: Number(record.checkIn),
        checkOut: record.checkOut != null ? Number(record.checkOut) : undefined,
        totalHours: record.totalHours ?? undefined,
        status: (record.status as AttendanceRecord["status"]) || "present",
        delay_minutes:
          record.delayMinutes != null ? Number(record.delayMinutes) : undefined,
        early_leave_minutes:
          record.earlyLeaveMinutes != null
            ? Number(record.earlyLeaveMinutes)
            : undefined,
        overtime_minutes:
          record.overtimeMinutes != null
            ? Number(record.overtimeMinutes)
            : undefined,
      };
      await dbPutAttendance(idbAtt);
    }

    // Hydrate permissions
    for (const perm of allPermissions) {
      const idbPerm: PermissionRecord = {
        id: perm.id,
        companyId: perm.companyId,
        workerId: perm.workerId,
        reason: perm.reason,
        hours: perm.hours,
        status: (perm.status as PermissionRecord["status"]) || "pending",
        createdAt: Number(perm.createdAt),
      };
      await dbPutPermission(idbPerm);
    }

    lastVersion = newVersion;

    try {
      broadcastChannel?.postMessage({
        type: "sync-done",
        status: "synced",
        version: newVersion.toString(),
      });
    } catch {
      // ignore postMessage failures
    }

    notifySubscribers("synced");

    for (const cb of refreshCallbacks) {
      cb();
    }
  } catch (err) {
    console.warn("[SyncService] Sync failed:", err);
    notifySubscribers("error");
  }
}

export function getSyncStatus(): SyncStatus {
  return _syncStatus;
}

export function onSyncRefresh(cb: RefreshCallback): () => void {
  refreshCallbacks.add(cb);
  return () => refreshCallbacks.delete(cb);
}

export function startSync(companyId: string): () => void {
  currentCompanyId = companyId;
  lastVersion = BigInt(-1);

  setupBroadcastChannel();

  const handleVisibility = () => {
    if (document.hidden) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    } else {
      if (currentCompanyId && !pollTimer) {
        schedulePoll();
      }
    }
  };
  document.addEventListener("visibilitychange", handleVisibility);

  schedulePoll();

  return () => {
    document.removeEventListener("visibilitychange", handleVisibility);
    stopSync();
  };
}

function schedulePoll() {
  if (pollTimer) clearInterval(pollTimer);

  if (currentCompanyId) {
    performSync(currentCompanyId);
  }

  pollTimer = setInterval(() => {
    if (currentCompanyId && !document.hidden) {
      performSync(currentCompanyId);
    }
  }, POLL_INTERVAL_MS);
}

export function stopSync() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  currentCompanyId = null;
  lastVersion = BigInt(-1);
  _actor = null;
  isLeader = false;
  broadcastChannel?.close();
  broadcastChannel = null;
  notifySubscribers("idle");
}

export function onSyncUpdate(cb: SyncUpdateCallback): () => void {
  subscribers.add(cb);
  cb(_syncStatus);
  return () => subscribers.delete(cb);
}
