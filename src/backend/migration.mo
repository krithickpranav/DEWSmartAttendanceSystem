import Map "mo:core/Map";
import WorkerTypes "./types/workers";
import AttendanceTypes "./types/attendance";
import SettingsTypes "./types/settings";
import SyncLib "./lib/sync";

module {
  // --- Old types (inline, copied from .old/src/backend/main.mo) ---
  type OldWorker = {
    id : Text;
    name : Text;
    department : Text;
    phone : Text;
    faceEmbeddings : Blob;
    enrolledAt : Int;
  };

  type OldAttendanceRecord = {
    id : Text;
    workerId : Text;
    date : Text;
    checkIn : Int;
    checkOut : ?Int;
    totalHours : ?Float;
    status : Text;
  };

  type OldPermissionRequest = {
    id : Text;
    workerId : Text;
    reason : Text;
    hours : Float;
    status : Text;
    createdAt : Int;
  };

  type OldCompanySettings = {
    latitude : Float;
    longitude : Float;
    radius : Float;
    wifiSsid : ?Text;
    updatedAt : Int;
  };

  type OldManagerCredentials = {
    keywordHash : Text;
    pinHash : Text;
    updatedAt : Int;
  };

  type OldActor = {
    workers : Map.Map<Text, OldWorker>;
    attendances : Map.Map<Text, OldAttendanceRecord>;
    permissions : Map.Map<Text, OldPermissionRequest>;
    companySettings : ?OldCompanySettings;
    managerCredentials : ?OldManagerCredentials;
  };

  type NewActor = {
    workers : Map.Map<Text, WorkerTypes.Worker>;
    attendances : Map.Map<Text, AttendanceTypes.AttendanceRecord>;
    permissions : Map.Map<Text, AttendanceTypes.PermissionRequest>;
    settingsStore : Map.Map<Text, SettingsTypes.CompanySettings>;
    timingStore : Map.Map<Text, SettingsTypes.CompanyTiming>;
    credentialsStore : Map.Map<Text, SettingsTypes.ManagerCredentials>;
    syncVersions : Map.Map<Text, Nat>;
  };

  // Default companyId used when migrating data that had no company isolation
  let defaultCompanyId = "deepam-engineering";

  public func run(old : OldActor) : NewActor {
    // Migrate workers: add companyId field
    let workers = old.workers.map<Text, OldWorker, WorkerTypes.Worker>(
      func(_key, w) {
        {
          id = w.id;
          companyId = defaultCompanyId;
          name = w.name;
          department = w.department;
          phone = w.phone;
          faceEmbeddings = w.faceEmbeddings;
          enrolledAt = w.enrolledAt;
        }
      }
    );

    // Migrate attendances: add companyId and new optional fields
    let attendances = old.attendances.map<Text, OldAttendanceRecord, AttendanceTypes.AttendanceRecord>(
      func(_key, a) {
        {
          id = a.id;
          companyId = defaultCompanyId;
          workerId = a.workerId;
          date = a.date;
          checkIn = a.checkIn;
          checkOut = a.checkOut;
          totalHours = a.totalHours;
          delayMinutes = null;
          earlyLeaveMinutes = null;
          overtimeMinutes = null;
          status = a.status;
        }
      }
    );

    // Migrate permissions: add companyId field
    let permissions = old.permissions.map<Text, OldPermissionRequest, AttendanceTypes.PermissionRequest>(
      func(_key, p) {
        {
          id = p.id;
          companyId = defaultCompanyId;
          workerId = p.workerId;
          reason = p.reason;
          hours = p.hours;
          status = p.status;
          createdAt = p.createdAt;
        }
      }
    );

    // Migrate companySettings: from scalar to Map keyed by companyId
    let settingsStore = Map.empty<Text, SettingsTypes.CompanySettings>();
    switch (old.companySettings) {
      case (?s) {
        settingsStore.add(
          defaultCompanyId,
          {
            companyId = defaultCompanyId;
            latitude = s.latitude;
            longitude = s.longitude;
            radius = s.radius;
            wifiSsid = s.wifiSsid;
            updatedAt = s.updatedAt;
          },
        );
      };
      case null {};
    };

    // Migrate managerCredentials: from scalar to Map keyed by companyId
    let credentialsStore = Map.empty<Text, SettingsTypes.ManagerCredentials>();
    switch (old.managerCredentials) {
      case (?c) {
        credentialsStore.add(
          defaultCompanyId,
          {
            companyId = defaultCompanyId;
            keywordHash = c.keywordHash;
            pinHash = c.pinHash;
            updatedAt = c.updatedAt;
          },
        );
      };
      case null {};
    };

    let timingStore = Map.empty<Text, SettingsTypes.CompanyTiming>();
    let syncVersions = Map.empty<Text, Nat>();

    {
      workers;
      attendances;
      permissions;
      settingsStore;
      timingStore;
      credentialsStore;
      syncVersions;
    };
  };
};
