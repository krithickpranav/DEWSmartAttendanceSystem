module {
  public type AttendanceRecord = {
    id : Text;
    companyId : Text;
    workerId : Text;
    date : Text;
    checkIn : Int;
    checkOut : ?Int;
    totalHours : ?Float;
    delayMinutes : ?Nat;
    earlyLeaveMinutes : ?Nat;
    overtimeMinutes : ?Nat;
    status : Text;
  };

  public type PermissionRequest = {
    id : Text;
    companyId : Text;
    workerId : Text;
    reason : Text;
    hours : Float;
    status : Text; // "pending" | "approved" | "rejected"
    createdAt : Int;
  };
};
