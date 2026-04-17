import AttendanceLib "../lib/attendance";
import SyncLib "../lib/sync";
import AttendanceTypes "../types/attendance";

mixin (
  attendances : AttendanceLib.AttendanceStore,
  permissions : AttendanceLib.PermissionStore,
  syncVersions : SyncLib.SyncVersionStore,
) {
  public shared func checkIn(
    companyId : Text,
    workerId : Text,
    date : Text,
    delayMinutes : ?Nat,
  ) : async () {
    AttendanceLib.checkIn(attendances, companyId, workerId, date, delayMinutes);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };

  public shared func checkOut(
    companyId : Text,
    workerId : Text,
    date : Text,
    earlyLeaveMinutes : ?Nat,
    overtimeMinutes : ?Nat,
  ) : async () {
    AttendanceLib.checkOut(attendances, companyId, workerId, date, earlyLeaveMinutes, overtimeMinutes);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };

  public query func getAttendance(companyId : Text, workerId : Text, date : Text) : async ?AttendanceTypes.AttendanceRecord {
    AttendanceLib.getAttendance(attendances, companyId, workerId, date);
  };

  public query func getAttendanceByWorker(companyId : Text, workerId : Text) : async [AttendanceTypes.AttendanceRecord] {
    AttendanceLib.getAttendanceByWorker(attendances, companyId, workerId);
  };

  public query func getAllAttendance(companyId : Text) : async [AttendanceTypes.AttendanceRecord] {
    AttendanceLib.getAllAttendance(attendances, companyId);
  };

  public shared func requestPermission(
    companyId : Text,
    workerId : Text,
    reason : Text,
    hours : Float,
  ) : async () {
    AttendanceLib.requestPermission(permissions, companyId, workerId, reason, hours);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };

  public shared func updatePermissionStatus(companyId : Text, permissionId : Text, newStatus : Text) : async () {
    AttendanceLib.updatePermissionStatus(permissions, companyId, permissionId, newStatus);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };

  public query func getPermissionRequests(companyId : Text, workerId : Text) : async [AttendanceTypes.PermissionRequest] {
    AttendanceLib.getPermissionRequests(permissions, companyId, workerId);
  };

  public query func getAllPermissions(companyId : Text) : async [AttendanceTypes.PermissionRequest] {
    AttendanceLib.getAllPermissions(permissions, companyId);
  };
};
