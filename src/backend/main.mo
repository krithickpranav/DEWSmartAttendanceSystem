import Map "mo:core/Map";
import WorkersLib "lib/workers";
import AttendanceLib "lib/attendance";
import SettingsLib "lib/settings";
import SyncLib "lib/sync";
import WorkersMixin "mixins/workers-api";
import AttendanceMixin "mixins/attendance-api";
import SettingsMixin "mixins/settings-api";
import SyncMixin "mixins/sync-api";
import WorkerTypes "types/workers";
import AttendanceTypes "types/attendance";
import SettingsTypes "types/settings";
import Migration "migration";

(with migration = Migration.run)
actor {
  // --- State (persists via enhanced orthogonal persistence) ---
  let workers       : WorkersLib.WorkerStore        = Map.empty<Text, WorkerTypes.Worker>();
  let attendances   : AttendanceLib.AttendanceStore  = Map.empty<Text, AttendanceTypes.AttendanceRecord>();
  let permissions   : AttendanceLib.PermissionStore  = Map.empty<Text, AttendanceTypes.PermissionRequest>();
  let settingsStore : SettingsLib.SettingsStore       = Map.empty<Text, SettingsTypes.CompanySettings>();
  let timingStore   : SettingsLib.TimingStore         = Map.empty<Text, SettingsTypes.CompanyTiming>();
  let credentialsStore : SettingsLib.CredentialsStore = Map.empty<Text, SettingsTypes.ManagerCredentials>();
  let syncVersions  : SyncLib.SyncVersionStore        = Map.empty<Text, Nat>();

  // --- Mixin composition ---
  include WorkersMixin(workers, syncVersions);
  include AttendanceMixin(attendances, permissions, syncVersions);
  include SettingsMixin(settingsStore, timingStore, credentialsStore, syncVersions);
  include SyncMixin(syncVersions);
};
