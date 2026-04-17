module {
  public type CompanySettings = {
    companyId : Text;
    latitude : Float;
    longitude : Float;
    radius : Float;
    wifiSsid : ?Text;
    updatedAt : Int;
  };

  public type CompanyTiming = {
    id : Text;
    companyId : Text;
    startTime : Text; // "HH:MM"
    endTime : Text;   // "HH:MM"
    gracePeriodMinutes : Nat;
    updatedAt : Int;
  };

  public type ManagerCredentials = {
    companyId : Text;
    keywordHash : Text;
    pinHash : Text;
    updatedAt : Int;
  };
};
