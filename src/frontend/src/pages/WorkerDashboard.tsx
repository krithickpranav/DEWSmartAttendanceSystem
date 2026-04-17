import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarDays,
  CheckCircle,
  ClipboardList,
  Clock,
  LogOut,
  MapPin,
  RefreshCw,
  ScanFace,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SyncIndicator } from "../components/SyncIndicator";
import { useAuth } from "../contexts/AuthContext";
import { useBackend } from "../hooks/useBackend";
import {
  type AttendanceRecord,
  type PermissionRecord,
  dbGetAttendance,
  dbGetSettings,
  dbGetTiming,
  dbGetWorkerPermissions,
  dbPutAttendance,
  dbPutPermission,
} from "../lib/db";
import { checkGeoAccess } from "../lib/geoRestriction";
import { onSyncRefresh } from "../lib/sync";

type GeoStatus = "unknown" | "inside" | "outside" | "checking";

// ===== WORKER AI ASSISTANT =====
function WorkerAIAssistant({
  attendance,
  permissions,
}: {
  attendance: AttendanceRecord | null;
  permissions: PermissionRecord[];
}) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const getAnswer = (q: string): string => {
    // --- Today's status ---
    if (
      q.includes("status today") ||
      q.includes("today") ||
      q.includes("am i checked in") ||
      q.includes("check in")
    ) {
      if (!attendance?.checkIn) return "You have not checked in today.";
      if (!attendance.checkOut)
        return `You checked in at ${new Date(attendance.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Not yet checked out.`;
      return `Checked in: ${new Date(attendance.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, Checked out: ${new Date(attendance.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Total: ${attendance.totalHours?.toFixed(2)}h.`;
    }
    if (
      q.includes("check out") ||
      q.includes("checked out") ||
      q.includes("am i out")
    ) {
      if (!attendance?.checkOut) return "You have not checked out yet.";
      return `You checked out at ${new Date(attendance.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
    }
    if (
      q.includes("total hours") ||
      q.includes("how long") ||
      q.includes("how many hours")
    ) {
      if (!attendance?.checkIn) return "You haven't checked in today.";
      if (attendance.totalHours)
        return `Total hours worked today: ${attendance.totalHours.toFixed(2)} hours.`;
      const now = Date.now();
      const diff = (now - new Date(attendance.checkIn).getTime()) / 3600000;
      return `You've been working for approximately ${diff.toFixed(2)} hours (still checked in).`;
    }
    if (q.includes("delay") || q.includes("late") || q.includes("am i late")) {
      const d = attendance?.delay_minutes ?? 0;
      return d > 0
        ? `You were ${formatMinutes(d)} late today. ⚠️`
        : "No delay — you arrived on time today! ✅";
    }
    if (q.includes("overtime today") || q.includes("total overtime")) {
      const ot = attendance?.overtime_minutes ?? 0;
      return ot > 0
        ? `You have ${formatMinutes(ot)} overtime today. 🕐`
        : "No overtime recorded today.";
    }

    // --- History (limited to today context) ---
    if (
      q.includes("this week") ||
      q.includes("my week") ||
      q.includes("attendance this week")
    ) {
      return "Your weekly history is available in the Attendance tab. Today's record is shown on the dashboard.";
    }
    if (q.includes("this month") || q.includes("my month")) {
      return "Your monthly history is available in the Attendance tab. Check there for full records.";
    }

    // --- Permissions ---
    if (q.includes("pending")) {
      const count = permissions.filter((p) => p.status === "pending").length;
      return count === 0
        ? "You have no pending permissions."
        : `You have ${count} pending permission request${count !== 1 ? "s" : ""}.`;
    }
    if (q.includes("approved")) {
      const count = permissions.filter((p) => p.status === "approved").length;
      return count === 0
        ? "No approved permissions."
        : `You have ${count} approved permission${count !== 1 ? "s" : ""}.`;
    }
    if (
      q.includes("permission") ||
      q.includes("my permission") ||
      q.includes("leave request")
    ) {
      const pending = permissions.filter((p) => p.status === "pending").length;
      const approved = permissions.filter(
        (p) => p.status === "approved",
      ).length;
      const rejected = permissions.filter(
        (p) => p.status === "rejected",
      ).length;
      return `Your permissions — Pending: ${pending}, Approved: ${approved}, Rejected: ${rejected}.`;
    }

    // --- Help ---
    if (q.includes("help") || q.includes("what can you do")) {
      return [
        "I can help you with:",
        "• My status today / Am I checked in?",
        "• Check out time / Total hours",
        "• Am I late? / Delay today",
        "• Overtime today",
        "• My permissions / Pending requests",
      ].join("\n");
    }

    return "Try asking: 'My status today', 'Am I late?', 'Overtime today', 'My permissions', 'Total hours'.";
  };

  const handleAsk = (question?: string) => {
    const q = (question ?? input).toLowerCase().trim();
    if (!q) return;
    const a = getAnswer(q);
    setHistory((prev) => [...prev.slice(-7), { q: question ?? input, a }]);
    setInput("");
  };

  const handleClear = () => {
    setHistory([]);
    setInput("");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on history change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const chips = [
    "My status today",
    "Am I late?",
    "Overtime today",
    "My permissions",
    "Total hours",
  ];

  return (
    <div
      className="bg-card border border-brand/30 rounded-xl p-4 sm:p-6 mt-4"
      data-ocid="worker.ai_assistant.panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center">
          <span className="text-brand text-xs font-bold">AI</span>
        </div>
        <h3 className="text-foreground font-semibold">AI Assistant</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          Offline · Instant
        </span>
      </div>

      {/* Chat history */}
      <div className="max-h-48 overflow-y-auto flex flex-col gap-2 mb-3 pr-1">
        {history.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Ask a question about your attendance below.
          </p>
        )}
        {history.map((item, i) => (
          <div
            key={`msg-${i}-${item.q.slice(0, 10)}`}
            className="flex flex-col gap-1"
          >
            <div className="flex justify-end">
              <span className="bg-brand/20 text-foreground text-xs rounded-xl rounded-tr-sm px-3 py-2 max-w-[80%] text-right">
                {item.q}
              </span>
            </div>
            <div className="flex justify-start">
              <span
                className="bg-muted text-foreground text-xs rounded-xl rounded-tl-sm px-3 py-2 max-w-[85%] whitespace-pre-line"
                data-ocid="worker.ai_assistant.success_state"
              >
                {item.a}
              </span>
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Suggestion chips */}
      <div className="mb-2">
        <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
          Suggestions
        </p>
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <button
              type="button"
              key={chip}
              onClick={() => handleAsk(chip)}
              className="text-[10px] px-2 py-1 rounded-full border border-brand/30 bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
              data-ocid="worker.ai_assistant.button"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
          placeholder="Ask e.g. 'My status today'"
          className="flex-1 bg-input border-border"
          data-ocid="worker.ai_assistant.input"
        />
        <Button
          onClick={() => handleAsk()}
          className="bg-brand hover:bg-brand-dark text-white px-4"
          data-ocid="worker.ai_assistant.button"
        >
          Ask
        </Button>
        <Button
          onClick={handleClear}
          variant="outline"
          className="px-3"
          data-ocid="worker.ai_assistant.secondary_button"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

const COMPANY_LOGOS: Record<string, string> = {
  "deepam-engineering":
    "/assets/generated/deepam-engineering-logo-transparent.dim_400x400.png",
  "deepam-traders":
    "/assets/generated/deepam-traders-logo-transparent.dim_400x400.png",
};
function formatMinutes(mins: number): string {
  if (!mins || mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export default function WorkerDashboard() {
  const {
    currentWorker,
    logout,
    selectedCompany,
    idleWarning,
    dismissIdleWarning,
  } = useAuth();
  const { actor } = useBackend();
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [permReason, setPermReason] = useState("");
  const [permHours, setPermHours] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [submitting, setSubmitting] = useState(false);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("unknown");
  const [geoDistance, setGeoDistance] = useState(0);

  const today = new Date().toISOString().split("T")[0];
  const workerId = currentWorker?.id ?? "";

  const checkLocation = useCallback(async () => {
    setGeoStatus("checking");
    const settings = await dbGetSettings(selectedCompany?.id);
    if (!settings || (settings.latitude === 0 && settings.longitude === 0)) {
      setGeoStatus("inside");
      setGeoDistance(0);
      return;
    }
    const result = await checkGeoAccess(
      settings.latitude,
      settings.longitude,
      settings.radius,
    );
    setGeoDistance(result.distance);
    setGeoStatus(result.allowed ? "inside" : "outside");
  }, [selectedCompany?.id]);

  const loadAttendanceAndPerms = useCallback(async () => {
    if (!workerId) return;
    const [att, perms] = await Promise.all([
      dbGetAttendance(workerId, today),
      dbGetWorkerPermissions(workerId),
    ]);
    setAttendance(att ?? null);
    setPermissions(perms.sort((a, b) => b.createdAt - a.createdAt));
  }, [workerId, today]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!workerId) return;
    loadAttendanceAndPerms();
    checkLocation();
  }, [workerId, loadAttendanceAndPerms, checkLocation]);

  // Auto-refresh when sync updates IndexedDB
  useEffect(() => {
    const unsub = onSyncRefresh(loadAttendanceAndPerms);
    return unsub;
  }, [loadAttendanceAndPerms]);

  const handleCheckIn = async () => {
    if (attendance?.checkIn) return;
    const now = Date.now();
    const timing = await dbGetTiming(selectedCompany?.id);
    let delay_minutes = 0;
    if (timing) {
      const todayDate = new Date();
      const [sh, sm] = timing.startTime.split(":").map(Number);
      const startMs = new Date(
        todayDate.getFullYear(),
        todayDate.getMonth(),
        todayDate.getDate(),
        sh,
        sm,
        0,
        0,
      ).getTime();
      const graceMs = startMs + timing.gracePeriodMinutes * 60000;
      if (now > graceMs) {
        delay_minutes = Math.round((now - startMs) / 60000);
      }
    }
    const record: AttendanceRecord = {
      id: `att-${workerId}-${today}`,
      companyId: selectedCompany?.id ?? "",
      workerId,
      date: today,
      checkIn: now,
      status: "present",
      delay_minutes,
    };
    await dbPutAttendance(record);
    setAttendance(record);
    // Sync to backend
    if (actor) {
      try {
        await actor.checkIn(
          selectedCompany?.id ?? "",
          workerId,
          today,
          delay_minutes > 0 ? BigInt(delay_minutes) : null,
        );
      } catch (e) {
        console.warn("[Backend] checkIn failed:", e);
      }
    }
    toast.success("Checked in successfully!");
  };

  const handleCheckOut = async () => {
    if (!attendance?.checkIn || attendance.checkOut) return;
    const checkOut = Date.now();
    const totalHours = (checkOut - attendance.checkIn) / 3600000;
    const timing = await dbGetTiming(selectedCompany?.id);
    let overtime_minutes = 0;
    let early_leave_minutes = 0;
    if (timing) {
      const todayDate = new Date();
      const [eh, em] = timing.endTime.split(":").map(Number);
      const endMs = new Date(
        todayDate.getFullYear(),
        todayDate.getMonth(),
        todayDate.getDate(),
        eh,
        em,
        0,
        0,
      ).getTime();
      if (checkOut > endMs) {
        overtime_minutes = Math.round((checkOut - endMs) / 60000);
      } else if (checkOut < endMs) {
        early_leave_minutes = Math.round((endMs - checkOut) / 60000);
      }
    }
    const updated: AttendanceRecord = {
      ...attendance,
      checkOut,
      totalHours,
      overtime_minutes,
      early_leave_minutes,
    };
    await dbPutAttendance(updated);
    setAttendance(updated);
    // Sync to backend
    if (actor) {
      try {
        await actor.checkOut(
          selectedCompany?.id ?? "",
          workerId,
          today,
          early_leave_minutes > 0 ? BigInt(early_leave_minutes) : null,
          overtime_minutes > 0 ? BigInt(overtime_minutes) : null,
        );
      } catch (e) {
        console.warn("[Backend] checkOut failed:", e);
      }
    }
    toast.success(`Checked out! Total: ${totalHours.toFixed(2)} hours`);
  };

  const handlePermissionRequest = async () => {
    if (!permReason.trim() || !permHours) {
      toast.error("Fill all fields");
      return;
    }
    setSubmitting(true);
    try {
      const companyId = selectedCompany?.id ?? "";
      const hours = Number.parseFloat(permHours);
      const record: PermissionRecord = {
        id: `perm-${workerId}-${Date.now()}`,
        companyId,
        workerId,
        reason: permReason,
        hours,
        status: "pending",
        createdAt: Date.now(),
      };
      await dbPutPermission(record);
      setPermissions((p) => [record, ...p]);
      // Sync to backend
      if (actor) {
        try {
          await actor.requestPermission(companyId, workerId, permReason, hours);
        } catch (e) {
          console.warn("[Backend] requestPermission failed:", e);
        }
      }
      setPermReason("");
      setPermHours("");
      toast.success("Permission request submitted!");
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const statusColors: Record<string, string> = {
    pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    approved: "bg-green-500/20 text-green-400 border-green-500/30",
    rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const geoChipClass =
    geoStatus === "checking"
      ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
      : geoStatus === "inside"
        ? "bg-green-500/10 border-green-500/30 text-green-400"
        : "bg-red-500/10 border-red-500/30 text-red-400";

  return (
    <div
      className="min-h-screen"
      style={{
        background: "linear-gradient(135deg, #0B1220 0%, #101A2A 100%)",
      }}
    >
      {/* Idle warning modal */}
      {idleWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-card border border-amber-500/50 rounded-xl p-6 max-w-sm w-full text-center shadow-2xl">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-foreground font-semibold text-lg mb-2">
              Session Expiring
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              You will be logged out in 1 minute due to inactivity.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button
                className="bg-brand hover:bg-brand-dark text-white"
                onClick={dismissIdleWarning}
              >
                Stay Logged In
              </Button>
              <Button
                variant="outline"
                className="border-border text-muted-foreground"
                onClick={logout}
              >
                Logout Now
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-3 sm:px-6 py-2 sm:py-4">
          {/* Top row: logo + time + logout */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0">
                {selectedCompany ? (
                  <img
                    src={COMPANY_LOGOS[selectedCompany.id]}
                    alt={`${selectedCompany.name} logo`}
                    className="w-8 h-8 object-contain"
                  />
                ) : (
                  <ScanFace className="w-4 h-4 text-brand" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground leading-none truncate max-w-[130px] sm:max-w-none">
                  {selectedCompany?.name ?? "Worker Portal"}
                </p>
                <p className="text-sm font-semibold text-foreground truncate max-w-[130px] sm:max-w-none">
                  {currentWorker?.name}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <SyncIndicator />
              {/* Time: shown on all screen sizes, smaller on mobile */}
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground hidden xs:block">
                  {today}
                </p>
                <p className="text-xs sm:text-sm font-mono text-foreground">
                  {currentTime.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                className="border-border text-muted-foreground hover:text-foreground h-9 px-2 sm:px-3"
                data-ocid="worker.logout.button"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline ml-1">Logout</span>
              </Button>
            </div>
          </div>

          {/* Bottom row: location chip + update button */}
          {geoStatus !== "unknown" && (
            <div className="flex items-center gap-2 mt-1.5">
              <div
                className={`flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium min-w-0 flex-shrink ${geoChipClass}`}
                data-ocid="worker.location.panel"
              >
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate max-w-[120px] sm:max-w-none">
                  {geoStatus === "checking"
                    ? "Checking..."
                    : geoStatus === "inside"
                      ? geoDistance > 0
                        ? `Inside (${geoDistance}m)`
                        : "Inside Range"
                      : `Outside (${geoDistance}m)`}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={checkLocation}
                disabled={geoStatus === "checking"}
                className="border-border text-muted-foreground hover:text-foreground gap-1 flex-shrink-0 h-8 px-2"
                data-ocid="worker.update_location.button"
              >
                <RefreshCw
                  className={`w-3 h-3 ${geoStatus === "checking" ? "animate-spin" : ""}`}
                />
                <span className="hidden sm:inline text-xs">
                  Update Location
                </span>
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        {/* Worker info banner */}
        <div className="bg-brand/10 border border-brand/30 rounded-xl p-4 mb-6 flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-brand/20 border border-brand/40 flex items-center justify-center text-brand font-bold text-base sm:text-lg flex-shrink-0">
            {currentWorker?.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground font-semibold truncate">
              {currentWorker?.name}
            </p>
            <p className="text-muted-foreground text-sm truncate">
              {currentWorker?.department} &bull; {currentWorker?.id}
            </p>
          </div>
          <div className="flex-shrink-0">
            {attendance?.checkIn ? (
              <Badge className="bg-green-500/20 text-green-400 border border-green-500/30">
                {attendance.checkOut ? "Checked Out" : "Checked In"}
              </Badge>
            ) : (
              <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30">
                Not Checked In
              </Badge>
            )}
          </div>
        </div>

        {/* Outside range warning */}
        {geoStatus === "outside" && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 flex flex-wrap items-start sm:items-center gap-3">
            <MapPin className="w-5 h-5 text-red-400 shrink-0 mt-0.5 sm:mt-0" />
            <div className="flex-1 min-w-0">
              <p className="text-red-400 font-medium text-sm">
                You are outside the company range ({geoDistance}m away)
              </p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Move closer to your workplace. Check-in may not be permitted.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={checkLocation}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0"
              data-ocid="worker.location.retry.button"
            >
              <RefreshCw className="w-3 h-3 mr-1" /> Retry
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {/* Check In */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-brand" />
              <h3 className="text-foreground font-semibold">Check In</h3>
            </div>
            {attendance?.checkIn ? (
              <div>
                <p className="text-2xl font-bold text-green-400">
                  {fmt(attendance.checkIn)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Already checked in
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not checked in yet
              </p>
            )}
            <Button
              className="w-full bg-brand hover:bg-brand-dark text-white min-h-[44px]"
              disabled={!!attendance?.checkIn}
              onClick={handleCheckIn}
              data-ocid="worker.checkin.button"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {attendance?.checkIn ? "Already Checked In" : "Check In Now"}
            </Button>
          </div>

          {/* Check Out */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-amber-400" />
              <h3 className="text-foreground font-semibold">Check Out</h3>
            </div>
            {attendance?.checkOut ? (
              <div>
                <p className="text-2xl font-bold text-amber-400">
                  {fmt(attendance.checkOut)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Total: {attendance.totalHours?.toFixed(2)}h
                </p>
              </div>
            ) : attendance?.checkIn ? (
              <p className="text-sm text-muted-foreground">
                Working since {fmt(attendance.checkIn)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Check in first</p>
            )}
            <Button
              variant="outline"
              className="w-full border-amber-500/40 text-amber-400 hover:bg-amber-500/10 min-h-[44px]"
              disabled={!attendance?.checkIn || !!attendance?.checkOut}
              onClick={handleCheckOut}
              data-ocid="worker.checkout.button"
            >
              {attendance?.checkOut ? "Already Checked Out" : "Check Out Now"}
            </Button>
          </div>

          {/* Today's Summary */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-blue-400" />
              <h3 className="text-foreground font-semibold">Today</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Date</span>
                <span className="text-foreground">{today}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className="text-green-400">
                  {attendance?.checkIn ? "Present" : "Absent"}
                </span>
              </div>
              {attendance?.totalHours && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Hours</span>
                  <span className="text-foreground">
                    {attendance.totalHours.toFixed(2)}h
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Permission Request */}
        <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
          <h3 className="text-foreground font-semibold mb-4 flex items-center gap-2">
            <Send className="w-5 h-5 text-brand" /> Permission Request
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <Label className="text-muted-foreground text-xs">Reason</Label>
              <Textarea
                value={permReason}
                onChange={(e) => setPermReason(e.target.value)}
                placeholder="Describe your reason..."
                className="mt-1 bg-input border-border resize-none h-20"
                data-ocid="worker.permission.textarea"
              />
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">
                Duration (hours)
              </Label>
              <Input
                value={permHours}
                onChange={(e) => setPermHours(e.target.value)}
                type="number"
                min="0.5"
                step="0.5"
                placeholder="e.g. 2"
                className="mt-1 bg-input border-border"
                data-ocid="worker.permission.hours.input"
              />
              <Button
                className="w-full mt-3 bg-brand hover:bg-brand-dark text-white min-h-[44px]"
                onClick={handlePermissionRequest}
                disabled={submitting}
                data-ocid="worker.permission.submit_button"
              >
                Submit Request
              </Button>
            </div>
          </div>

          {/* Past permissions */}
          {permissions.length > 0 && (
            <div className="border-t border-border pt-4">
              <p className="text-muted-foreground text-xs mb-3">
                Past Requests
              </p>
              <div className="space-y-2">
                {permissions.map((p, i) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-start sm:items-center justify-between gap-2 p-3 rounded-lg bg-muted/30 border border-border"
                    data-ocid={`worker.permission.item.${i + 1}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground break-words">
                        {p.reason}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.hours}h &bull;{" "}
                        {new Date(p.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full border flex-shrink-0 ${statusColors[p.status]}`}
                    >
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <WorkerAIAssistant attendance={attendance} permissions={permissions} />
      </main>
    </div>
  );
}
