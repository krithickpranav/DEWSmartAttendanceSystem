import Map "mo:core/Map";

module {
  public type SyncVersionStore = Map.Map<Text, Nat>;

  /// Returns the current sync version for a company (starts at 0).
  public func getSyncVersion(store : SyncVersionStore, companyId : Text) : Nat {
    switch (store.get(companyId)) {
      case (?v) v;
      case null 0;
    };
  };

  /// Increments the sync version counter for a company. Call on every write.
  public func bumpSyncVersion(store : SyncVersionStore, companyId : Text) : () {
    let current = getSyncVersion(store, companyId);
    store.add(companyId, current + 1);
  };
};
