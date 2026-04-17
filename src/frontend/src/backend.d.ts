import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface CompanySettings {
    latitude: number;
    wifiSsid?: string;
    updatedAt: bigint;
    longitude: number;
    radius: number;
    companyId: string;
}
export interface ManagerCredentials {
    keywordHash: string;
    updatedAt: bigint;
    pinHash: string;
    companyId: string;
}
export interface PermissionRequest {
    id: string;
    status: string;
    workerId: string;
    hours: number;
    createdAt: bigint;
    reason: string;
    companyId: string;
}
export interface CompanyTiming {
    id: string;
    startTime: string;
    endTime: string;
    updatedAt: bigint;
    gracePeriodMinutes: bigint;
    companyId: string;
}
export interface AttendanceRecord {
    id: string;
    status: string;
    workerId: string;
    checkIn: bigint;
    totalHours?: number;
    date: string;
    checkOut?: bigint;
    earlyLeaveMinutes?: bigint;
    delayMinutes?: bigint;
    overtimeMinutes?: bigint;
    companyId: string;
}
export interface Worker {
    id: string;
    faceEmbeddings: Uint8Array;
    name: string;
    enrolledAt: bigint;
    phone: string;
    department: string;
    companyId: string;
}
export interface backendInterface {
    addWorker(companyId: string, id: string, name: string, department: string, phone: string, embeddings: Uint8Array): Promise<void>;
    checkIn(companyId: string, workerId: string, date: string, delayMinutes: bigint | null): Promise<void>;
    checkOut(companyId: string, workerId: string, date: string, earlyLeaveMinutes: bigint | null, overtimeMinutes: bigint | null): Promise<void>;
    deleteWorker(companyId: string, id: string): Promise<void>;
    getAllAttendance(companyId: string): Promise<Array<AttendanceRecord>>;
    getAllPermissions(companyId: string): Promise<Array<PermissionRequest>>;
    getAttendance(companyId: string, workerId: string, date: string): Promise<AttendanceRecord | null>;
    getAttendanceByWorker(companyId: string, workerId: string): Promise<Array<AttendanceRecord>>;
    getCompanySettings(companyId: string): Promise<CompanySettings | null>;
    getCompanyTiming(companyId: string): Promise<CompanyTiming | null>;
    getManagerCredentials(companyId: string): Promise<ManagerCredentials | null>;
    getPermissionRequests(companyId: string, workerId: string): Promise<Array<PermissionRequest>>;
    getSyncVersion(companyId: string): Promise<bigint>;
    getWorker(companyId: string, id: string): Promise<Worker>;
    listWorkers(companyId: string): Promise<Array<Worker>>;
    requestPermission(companyId: string, workerId: string, reason: string, hours: number): Promise<void>;
    setCompanySettings(companyId: string, latitude: number, longitude: number, radius: number, wifiSsid: string | null): Promise<void>;
    setCompanyTiming(companyId: string, startTime: string, endTime: string, gracePeriodMinutes: bigint): Promise<void>;
    setManagerCredentials(companyId: string, keywordHash: string, pinHash: string): Promise<void>;
    updatePermissionStatus(companyId: string, permissionId: string, newStatus: string): Promise<void>;
    updateWorker(companyId: string, id: string, name: string, department: string, phone: string): Promise<void>;
}
