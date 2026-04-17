import WorkersLib "../lib/workers";
import SyncLib "../lib/sync";
import WorkerTypes "../types/workers";

mixin (
  workers : WorkersLib.WorkerStore,
  syncVersions : SyncLib.SyncVersionStore,
) {
  public shared func addWorker(
    companyId : Text,
    id : Text,
    name : Text,
    department : Text,
    phone : Text,
    embeddings : Blob,
  ) : async () {
    WorkersLib.addWorker(workers, companyId, id, name, department, phone, embeddings);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };

  public query func getWorker(companyId : Text, id : Text) : async WorkerTypes.Worker {
    switch (WorkersLib.getWorker(workers, companyId, id)) {
      case (?w) w;
      case null { assert false; loop {} };
    };
  };

  public query func listWorkers(companyId : Text) : async [WorkerTypes.Worker] {
    WorkersLib.listWorkers(workers, companyId);
  };

  public shared func updateWorker(
    companyId : Text,
    id : Text,
    name : Text,
    department : Text,
    phone : Text,
  ) : async () {
    WorkersLib.updateWorker(workers, companyId, id, name, department, phone);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };

  public shared func deleteWorker(companyId : Text, id : Text) : async () {
    WorkersLib.deleteWorker(workers, companyId, id);
    SyncLib.bumpSyncVersion(syncVersions, companyId);
  };
};
