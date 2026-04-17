import Map "mo:core/Map";
import Time "mo:core/Time";
import Types "../types/settings";

module {
  public type SettingsStore = Map.Map<Text, Types.CompanySettings>;
  public type TimingStore = Map.Map<Text, Types.CompanyTiming>;
  public type CredentialsStore = Map.Map<Text, Types.ManagerCredentials>;

  public func setCompanySettings(
    store : SettingsStore,
    companyId : Text,
    latitude : Float,
    longitude : Float,
    radius : Float,
    wifiSsid : ?Text,
  ) : () {
    store.add(
      companyId,
      {
        companyId;
        latitude;
        longitude;
        radius;
        wifiSsid;
        updatedAt = Time.now();
      },
    );
  };

  public func getCompanySettings(store : SettingsStore, companyId : Text) : ?Types.CompanySettings {
    store.get(companyId);
  };

  public func setCompanyTiming(
    store : TimingStore,
    companyId : Text,
    startTime : Text,
    endTime : Text,
    gracePeriodMinutes : Nat,
  ) : () {
    store.add(
      companyId,
      {
        id = companyId;
        companyId;
        startTime;
        endTime;
        gracePeriodMinutes;
        updatedAt = Time.now();
      },
    );
  };

  public func getCompanyTiming(store : TimingStore, companyId : Text) : ?Types.CompanyTiming {
    store.get(companyId);
  };

  public func setManagerCredentials(
    store : CredentialsStore,
    companyId : Text,
    keywordHash : Text,
    pinHash : Text,
  ) : () {
    store.add(
      companyId,
      {
        companyId;
        keywordHash;
        pinHash;
        updatedAt = Time.now();
      },
    );
  };

  public func getManagerCredentials(store : CredentialsStore, companyId : Text) : ?Types.ManagerCredentials {
    store.get(companyId);
  };
};
