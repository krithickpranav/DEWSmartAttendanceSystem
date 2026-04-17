import Map "mo:core/Map";
import Time "mo:core/Time";
import Int "mo:core/Int";
import Types "../types/attendance";

module {
  public type AttendanceStore = Map.Map<Text, Types.AttendanceRecord>;
  public type PermissionStore = Map.Map<Text, Types.PermissionRequest>;

  // Key: companyId # ":" # workerId # ":" # date
  func attendanceKey(companyId : Text, workerId : Text, date : Text) : Text {
    companyId # ":" # workerId # ":" # date;
  };

  // Key: companyId # ":" # permissionId
  func permissionKey(companyId : Text, permissionId : Text) : Text {
    companyId # ":" # permissionId;
  };

  public func checkIn(
    store : AttendanceStore,
    companyId : Text,
    workerId : Text,
    date : Text,
    delayMinutes : ?Nat,
  ) : () {
    let id = companyId # ":" # workerId # ":" # date;
    let record : Types.AttendanceRecord = {
      id;
      companyId;
      workerId;
      date;
      checkIn = Time.now();
      checkOut = null;
      totalHours = null;
      delayMinutes;
      earlyLeaveMinutes = null;
      overtimeMinutes = null;
      status = "present";
    };
    store.add(attendanceKey(companyId, workerId, date), record);
  };

  public func checkOut(
    store : AttendanceStore,
    companyId : Text,
    workerId : Text,
    date : Text,
    earlyLeaveMinutes : ?Nat,
    overtimeMinutes : ?Nat,
  ) : () {
    let key = attendanceKey(companyId, workerId, date);
    switch (store.get(key)) {
      case (?existing) {
        let checkOutTime = Time.now();
        let totalHours : ?Float = do {
          let diffNs : Int = checkOutTime - existing.checkIn;
          if (diffNs > 0) {
            ?(diffNs.toFloat() / 3_600_000_000_000.0)
          } else {
            null
          }
        };
        store.add(
          key,
          {
            existing with
            checkOut = ?checkOutTime;
            totalHours;
            earlyLeaveMinutes;
            overtimeMinutes;
          },
        );
      };
      case null {};
    };
  };

  public func getAttendance(store : AttendanceStore, companyId : Text, workerId : Text, date : Text) : ?Types.AttendanceRecord {
    store.get(attendanceKey(companyId, workerId, date));
  };

  public func getAttendanceByWorker(store : AttendanceStore, companyId : Text, workerId : Text) : [Types.AttendanceRecord] {
    let prefix = companyId # ":" # workerId # ":";
    store.entries()
      .filter(func((k, _v)) { k.startsWith(#text prefix) })
      .map(func((_k, v) : (Text, Types.AttendanceRecord)) : Types.AttendanceRecord { v })
      .toArray();
  };

  public func getAllAttendance(store : AttendanceStore, companyId : Text) : [Types.AttendanceRecord] {
    let prefix = companyId # ":";
    store.entries()
      .filter(func((k, _v)) { k.startsWith(#text prefix) })
      .map(func((_k, v) : (Text, Types.AttendanceRecord)) : Types.AttendanceRecord { v })
      .toArray();
  };

  public func deleteWorkerAttendance(store : AttendanceStore, companyId : Text, workerId : Text) : () {
    let prefix = companyId # ":" # workerId # ":";
    let toDelete = store.entries()
      .filter(func((k, _v)) { k.startsWith(#text prefix) })
      .map(func((k, _v) : (Text, Types.AttendanceRecord)) : Text { k })
      .toArray();
    for (k in toDelete.values()) {
      store.remove(k);
    };
  };

  // Permissions
  public func requestPermission(
    store : PermissionStore,
    companyId : Text,
    workerId : Text,
    reason : Text,
    hours : Float,
  ) : () {
    let now = Time.now();
    // Generate a unique id from companyId + workerId + timestamp
    let id = companyId # ":" # workerId # ":" # now.toText();
    let permission : Types.PermissionRequest = {
      id;
      companyId;
      workerId;
      reason;
      hours;
      status = "pending";
      createdAt = now;
    };
    store.add(permissionKey(companyId, id), permission);
  };

  public func updatePermissionStatus(store : PermissionStore, companyId : Text, permissionId : Text, newStatus : Text) : () {
    let key = permissionKey(companyId, permissionId);
    switch (store.get(key)) {
      case (?existing) {
        store.add(key, { existing with status = newStatus });
      };
      case null {};
    };
  };

  public func getPermissionRequests(store : PermissionStore, companyId : Text, workerId : Text) : [Types.PermissionRequest] {
    let prefix = companyId # ":";
    store.entries()
      .filter(func((k, _v)) { k.startsWith(#text prefix) })
      .map(func((_k, v) : (Text, Types.PermissionRequest)) : Types.PermissionRequest { v })
      .filter(func(p) { p.workerId == workerId })
      .toArray();
  };

  public func getAllPermissions(store : PermissionStore, companyId : Text) : [Types.PermissionRequest] {
    let prefix = companyId # ":";
    store.entries()
      .filter(func((k, _v)) { k.startsWith(#text prefix) })
      .map(func((_k, v) : (Text, Types.PermissionRequest)) : Types.PermissionRequest { v })
      .toArray();
  };

  public func deleteWorkerPermissions(store : PermissionStore, companyId : Text, workerId : Text) : () {
    let prefix = companyId # ":";
    let toDelete = store.entries()
      .filter(func((k, _v)) { k.startsWith(#text prefix) })
      .filter(func((_k, v)) { v.workerId == workerId })
      .map(func((k, _v) : (Text, Types.PermissionRequest)) : Text { k })
      .toArray();
    for (k in toDelete.values()) {
      store.remove(k);
    };
  };
};
