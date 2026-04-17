/**
 * SyncIndicator — small dot showing backend sync status.
 * Green = synced, yellow = syncing, red = error, gray = idle.
 */
import { useAuth } from "../contexts/AuthContext";

export function SyncIndicator() {
  const { syncStatus } = useAuth();

  const dotClass =
    syncStatus === "synced"
      ? "bg-green-400"
      : syncStatus === "syncing"
        ? "bg-amber-400 animate-pulse"
        : syncStatus === "error"
          ? "bg-red-400"
          : "bg-muted-foreground/30";

  const label =
    syncStatus === "synced"
      ? "Synced"
      : syncStatus === "syncing"
        ? "Syncing..."
        : syncStatus === "error"
          ? "Sync error"
          : "Offline";

  return (
    <div
      className="flex items-center gap-1.5"
      title={label}
      data-ocid="sync.status.panel"
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
      <span className="text-[10px] text-muted-foreground hidden sm:inline">
        {label}
      </span>
    </div>
  );
}
