import SettingsLib "../lib/settings";
import SyncLib "../lib/sync";
import SettingsTypes "../types/settings";

mixin (
  settingsStore : SettingsLib.SettingsStore,
  timingStore : SettingsLib.TimingStore,
  credentialsStore : SettingsLib.CredentialsStore,
  syncVersions : SyncLib.SyncVersionStore,
) {
  public shared func setCompanySettings(
    companyId : Text,
    latitude : Float,
    longitude : Float,
    radius : Float,
    wifiSsid : ?Text,
  ) : async () {
    SettingsLib.setCompanySettings(settingsStore, companyId, latitude, longitude, radius, wifiSsid);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };

  public query func getCompanySettings(companyId : Text) : async ?SettingsTypes.CompanySettings {
    SettingsLib.getCompanySettings(settingsStore, companyId);
  };

  public shared func setCompanyTiming(
    companyId : Text,
    startTime : Text,
    endTime : Text,
    gracePeriodMinutes : Nat,
  ) : async () {
    SettingsLib.setCompanyTiming(timingStore, companyId, startTime, endTime, gracePeriodMinutes);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };

  public query func getCompanyTiming(companyId : Text) : async ?SettingsTypes.CompanyTiming {
    SettingsLib.getCompanyTiming(timingStore, companyId);
  };

  public shared func setManagerCredentials(companyId : Text, keywordHash : Text, pinHash : Text) : async () {
    SettingsLib.setManagerCredentials(credentialsStore, companyId, keywordHash, pinHash);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };

  public query func getManagerCredentials(companyId : Text) : async ?SettingsTypes.ManagerCredentials {
    SettingsLib.getManagerCredentials(credentialsStore, companyId);
  };
};
