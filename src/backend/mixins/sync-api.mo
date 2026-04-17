import SyncLib "../lib/sync";

mixin (syncVersions : SyncLib.SyncVersionStore) {
  /// Returns a monotonically increasing counter per company.
  /// Clients poll this to detect any changes without fetching all data.
  public query func getSyncVersion(companyId : Text) : async Nat {
    SyncLib.getSyncVersion(syncVersions, companyId);
  };
};
