import Map "mo:core/Map";
import Time "mo:core/Time";
import Types "../types/workers";

module {
  public type WorkerStore = Map.Map<Text, Types.Worker>;

  // Key: companyId # ":" # workerId
  func makeKey(companyId : Text, id : Text) : Text {
    companyId # ":" # id;
  };

  public func addWorker(
    store : WorkerStore,
    companyId : Text,
    id : Text,
    name : Text,
    department : Text,
    phone : Text,
    embeddings : Blob,
  ) : () {
    let worker : Types.Worker = {
      id;
      companyId;
      name;
      department;
      phone;
      faceEmbeddings = embeddings;
      enrolledAt = Time.now();
    };
    store.add(makeKey(companyId, id), worker);
  };

  public func getWorker(store : WorkerStore, companyId : Text, id : Text) : ?Types.Worker {
    store.get(makeKey(companyId, id));
  };

  public func listWorkers(store : WorkerStore, companyId : Text) : [Types.Worker] {
    let prefix = companyId # ":";
    store.entries()
      .filter(func((k, _v)) { k.startsWith(#text prefix) })
      .map(func((_k, v) : (Text, Types.Worker)) : Types.Worker { v })
      .toArray();
  };

  public func updateWorker(
    store : WorkerStore,
    companyId : Text,
    id : Text,
    name : Text,
    department : Text,
    phone : Text,
  ) : () {
    let key = makeKey(companyId, id);
    switch (store.get(key)) {
      case (?existing) {
        store.add(key, { existing with name; department; phone });
      };
      case null {};
    };
  };

  public func deleteWorker(store : WorkerStore, companyId : Text, id : Text) : () {
    store.remove(makeKey(companyId, id));
  };
};
