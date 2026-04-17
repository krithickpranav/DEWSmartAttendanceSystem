import { hashSHA256 } from "./crypto";

export interface WorkerRecord {
  id: string;
  companyId: string;
  name: string;
  department: string;
  phone: string;
  faceEmbeddings: Float32Array;
  enrolledAt: number;
}

export interface AttendanceRecord {
  id: string;
  companyId: string;
  workerId: string;
  date: string;
  checkIn: number;
  checkOut?: number;
  totalHours?: number;
  status: "present" | "absent" | "permission";
  delay_minutes?: number;
  early_leave_minutes?: number;
  overtime_minutes?: number;
}

export interface PermissionRecord {
  id: string;
  companyId: string;
  workerId: string;
  reason: string;
  hours: number;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}

export interface SettingsRecord {
  id: string; // `settings-${companyId}`
  companyId: string;
  latitude: number;
  longitude: number;
  radius: number;
  wifiSsid?: string;
  updatedAt: number;
}

export interface ManagerRecord {
  id: "credentials";
  keywordHash: string;
  pinHash: string;
  updatedAt: number;
}

export interface CompanyTimingRecord {
  id: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  updatedAt: number;
}

const DB_NAME = "smart-attendance-db";
const DB_VERSION = 3;

let dbInstance: IDBDatabase | null = null;

/** Sanitize a string: trim whitespace and strip dangerous characters for HTML/SQL injection */
export function sanitizeInput(str: string): string {
  return str
    .trim()
    .replace(/[<>"';]/g, "")
    .replace(/--/g, "");
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      // Workers store
      if (!db.objectStoreNames.contains("workers")) {
        const ws = db.createObjectStore("workers", { keyPath: "id" });
        ws.createIndex("companyId", "companyId");
      } else {
        const tx = (e.target as IDBOpenDBRequest).transaction!;
        const ws = tx.objectStore("workers");
        if (!ws.indexNames.contains("companyId")) {
          ws.createIndex("companyId", "companyId");
        }
      }
      // Attendance store
      if (!db.objectStoreNames.contains("attendance")) {
        const as = db.createObjectStore("attendance", { keyPath: "id" });
        as.createIndex("workerId", "workerId");
        as.createIndex("date", "date");
        as.createIndex("companyId", "companyId");
      } else {
        const tx = (e.target as IDBOpenDBRequest).transaction!;
        const as = tx.objectStore("attendance");
        if (!as.indexNames.contains("companyId")) {
          as.createIndex("companyId", "companyId");
        }
      }
      // Permissions store
      if (!db.objectStoreNames.contains("permissions")) {
        const ps = db.createObjectStore("permissions", { keyPath: "id" });
        ps.createIndex("workerId", "workerId");
        ps.createIndex("companyId", "companyId");
      } else {
        const tx = (e.target as IDBOpenDBRequest).transaction!;
        const ps = tx.objectStore("permissions");
        if (!ps.indexNames.contains("companyId")) {
          ps.createIndex("companyId", "companyId");
        }
      }
      // Settings store
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }
      // Manager store
      if (!db.objectStoreNames.contains("manager")) {
        db.createObjectStore("manager", { keyPath: "id" });
      }
      // Timings store
      if (!db.objectStoreNames.contains("timings")) {
        db.createObjectStore("timings", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await openDB();
  await seedInitialData(dbInstance);
  return dbInstance;
}

function idbGet<T>(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAllByIndex<T>(
  db: IDBDatabase,
  store: string,
  indexName: string,
  value: IDBValidKey,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function randomEmbedding(): Float32Array {
  const arr = new Float32Array(128);
  for (let i = 0; i < 128; i++) arr[i] = (Math.random() - 0.5) * 2;
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < 128; i++) arr[i] /= norm;
  return arr;
}

async function seedInitialData(db: IDBDatabase) {
  const existingManager = await idbGet<ManagerRecord>(
    db,
    "manager",
    "credentials",
  );
  if (!existingManager) {
    const kwHash = await hashSHA256("admin");
    const pinHash = await hashSHA256("1234");
    await idbPut(db, "manager", {
      id: "credentials",
      keywordHash: kwHash,
      pinHash,
      updatedAt: Date.now(),
    });
  }

  // Seed per-company location settings
  const companies = [
    { id: "deepam-engineering", lat: 23.0225, lng: 72.5714 },
    { id: "deepam-traders", lat: 23.0395, lng: 72.5579 },
  ];
  for (const co of companies) {
    const existing = await idbGet<SettingsRecord>(
      db,
      "settings",
      `settings-${co.id}`,
    );
    if (!existing) {
      await idbPut(db, "settings", {
        id: `settings-${co.id}`,
        companyId: co.id,
        latitude: co.lat,
        longitude: co.lng,
        radius: 500,
        updatedAt: Date.now(),
      });
    }
  }

  const workers = await idbGetAll<WorkerRecord>(db, "workers");
  if (workers.length === 0) {
    const today = new Date().toISOString().split("T")[0];

    // Deepam Engineering Works workers
    const engWorkers: WorkerRecord[] = [
      {
        id: "DE-W001",
        companyId: "deepam-engineering",
        name: "Ramesh Patel",
        department: "Fabrication",
        phone: "9876543201",
        faceEmbeddings: randomEmbedding(),
        enrolledAt: Date.now() - 86400000 * 30,
      },
      {
        id: "DE-W002",
        companyId: "deepam-engineering",
        name: "Suresh Kumar",
        department: "Welding",
        phone: "9876543202",
        faceEmbeddings: randomEmbedding(),
        enrolledAt: Date.now() - 86400000 * 25,
      },
      {
        id: "DE-W003",
        companyId: "deepam-engineering",
        name: "Mahesh Shah",
        department: "Assembly",
        phone: "9876543203",
        faceEmbeddings: randomEmbedding(),
        enrolledAt: Date.now() - 86400000 * 20,
      },
    ];

    // Deepam Traders workers
    const traderWorkers: WorkerRecord[] = [
      {
        id: "DT-W001",
        companyId: "deepam-traders",
        name: "Nilesh Mehta",
        department: "Sales",
        phone: "9876543301",
        faceEmbeddings: randomEmbedding(),
        enrolledAt: Date.now() - 86400000 * 30,
      },
      {
        id: "DT-W002",
        companyId: "deepam-traders",
        name: "Vijay Modi",
        department: "Warehouse",
        phone: "9876543302",
        faceEmbeddings: randomEmbedding(),
        enrolledAt: Date.now() - 86400000 * 25,
      },
      {
        id: "DT-W003",
        companyId: "deepam-traders",
        name: "Priya Joshi",
        department: "Accounts",
        phone: "9876543303",
        faceEmbeddings: randomEmbedding(),
        enrolledAt: Date.now() - 86400000 * 20,
      },
    ];

    for (const w of [...engWorkers, ...traderWorkers]) {
      await idbPut(db, "workers", w);
    }

    // Seed today's attendance
    const engAtt: AttendanceRecord[] = [
      {
        id: `att-DE-W001-${today}`,
        companyId: "deepam-engineering",
        workerId: "DE-W001",
        date: today,
        checkIn: Date.now() - 3600000 * 8,
        checkOut: Date.now() - 3600000 * 0.5,
        totalHours: 7.5,
        status: "present",
        delay_minutes: 0,
        overtime_minutes: 30,
      },
      {
        id: `att-DE-W002-${today}`,
        companyId: "deepam-engineering",
        workerId: "DE-W002",
        date: today,
        checkIn: Date.now() - 3600000 * 7,
        status: "present",
        delay_minutes: 15,
      },
    ];
    const traderAtt: AttendanceRecord[] = [
      {
        id: `att-DT-W001-${today}`,
        companyId: "deepam-traders",
        workerId: "DT-W001",
        date: today,
        checkIn: Date.now() - 3600000 * 8,
        checkOut: Date.now() - 3600000 * 1,
        totalHours: 7,
        status: "present",
        delay_minutes: 0,
        overtime_minutes: 0,
      },
      {
        id: `att-DT-W002-${today}`,
        companyId: "deepam-traders",
        workerId: "DT-W002",
        date: today,
        checkIn: Date.now() - 3600000 * 7.5,
        status: "present",
        delay_minutes: 10,
      },
    ];
    for (const a of [...engAtt, ...traderAtt]) {
      await idbPut(db, "attendance", a);
    }
  }
}

// Workers
export async function dbGetAllWorkers(): Promise<WorkerRecord[]> {
  const db = await getDB();
  return idbGetAll<WorkerRecord>(db, "workers");
}

export async function dbGetAllWorkersByCompany(
  companyId: string,
): Promise<WorkerRecord[]> {
  const db = await getDB();
  return idbGetAllByIndex<WorkerRecord>(db, "workers", "companyId", companyId);
}

export async function dbGetWorker(
  id: string,
): Promise<WorkerRecord | undefined> {
  const db = await getDB();
  return idbGet<WorkerRecord>(db, "workers", id);
}

export async function dbPutWorker(worker: WorkerRecord): Promise<void> {
  const db = await getDB();
  // Sanitize text fields before saving
  const sanitized: WorkerRecord = {
    ...worker,
    name: sanitizeInput(worker.name),
    department: sanitizeInput(worker.department),
    phone: sanitizeInput(worker.phone),
  };
  await idbPut(db, "workers", sanitized);
}

export async function dbDeleteWorker(id: string): Promise<void> {
  const db = await getDB();
  await idbDelete(db, "workers", id);
}

// Attendance
export async function dbGetAttendance(
  workerId: string,
  date: string,
): Promise<AttendanceRecord | undefined> {
  const db = await getDB();
  return idbGet<AttendanceRecord>(db, "attendance", `att-${workerId}-${date}`);
}

export async function dbGetAllAttendance(): Promise<AttendanceRecord[]> {
  const db = await getDB();
  return idbGetAll<AttendanceRecord>(db, "attendance");
}

export async function dbGetAllAttendanceByCompany(
  companyId: string,
): Promise<AttendanceRecord[]> {
  const db = await getDB();
  return idbGetAllByIndex<AttendanceRecord>(
    db,
    "attendance",
    "companyId",
    companyId,
  );
}

export async function dbGetWorkerAttendance(
  workerId: string,
): Promise<AttendanceRecord[]> {
  const db = await getDB();
  return idbGetAllByIndex<AttendanceRecord>(
    db,
    "attendance",
    "workerId",
    workerId,
  );
}

export async function dbPutAttendance(record: AttendanceRecord): Promise<void> {
  const db = await getDB();
  await idbPut(db, "attendance", record);
}

// Permissions
export async function dbGetAllPermissions(): Promise<PermissionRecord[]> {
  const db = await getDB();
  return idbGetAll<PermissionRecord>(db, "permissions");
}

export async function dbGetAllPermissionsByCompany(
  companyId: string,
): Promise<PermissionRecord[]> {
  const db = await getDB();
  return idbGetAllByIndex<PermissionRecord>(
    db,
    "permissions",
    "companyId",
    companyId,
  );
}

export async function dbGetWorkerPermissions(
  workerId: string,
): Promise<PermissionRecord[]> {
  const db = await getDB();
  return idbGetAllByIndex<PermissionRecord>(
    db,
    "permissions",
    "workerId",
    workerId,
  );
}

export async function dbPutPermission(record: PermissionRecord): Promise<void> {
  const db = await getDB();
  await idbPut(db, "permissions", record);
}

export async function dbUpdatePermissionStatus(
  id: string,
  status: PermissionRecord["status"],
): Promise<void> {
  const db = await getDB();
  const record = await idbGet<PermissionRecord>(db, "permissions", id);
  if (record) {
    record.status = status;
    await idbPut(db, "permissions", record);
  }
}

// Settings (per-company)
export async function dbGetSettings(
  companyId?: string,
): Promise<SettingsRecord | undefined> {
  const db = await getDB();
  const key = companyId ? `settings-${companyId}` : "settings-default";
  return idbGet<SettingsRecord>(db, "settings", key);
}

export async function dbPutSettings(s: SettingsRecord): Promise<void> {
  const db = await getDB();
  await idbPut(db, "settings", s);
}

// Manager
export async function dbGetManager(): Promise<ManagerRecord | undefined> {
  const db = await getDB();
  return idbGet<ManagerRecord>(db, "manager", "credentials");
}

export async function dbPutManager(m: ManagerRecord): Promise<void> {
  const db = await getDB();
  await idbPut(db, "manager", m);
}

// Company Timing
export async function dbGetTiming(
  companyId?: string,
): Promise<CompanyTimingRecord | undefined> {
  const db = await getDB();
  const id = companyId ? `timing-${companyId}` : "timing-default";
  return idbGet<CompanyTimingRecord>(db, "timings", id);
}

export async function dbPutTiming(record: CompanyTimingRecord): Promise<void> {
  const db = await getDB();
  await idbPut(db, "timings", record);
}

// Delete worker and all associated attendance + permission records
export async function dbDeleteWorkerAllData(workerId: string): Promise<void> {
  const db = await getDB();
  await idbDelete(db, "workers", workerId);
  const allAtt = await idbGetAllByIndex<AttendanceRecord>(
    db,
    "attendance",
    "workerId",
    workerId,
  );
  for (const a of allAtt) {
    await idbDelete(db, "attendance", a.id);
  }
  const allPerms = await idbGetAllByIndex<PermissionRecord>(
    db,
    "permissions",
    "workerId",
    workerId,
  );
  for (const p of allPerms) {
    await idbDelete(db, "permissions", p.id);
  }
}
