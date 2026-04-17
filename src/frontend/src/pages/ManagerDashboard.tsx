import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit2,
  FileText,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  Menu,
  Plus,
  ScanFace,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SyncIndicator } from "../components/SyncIndicator";
import { useAuth } from "../contexts/AuthContext";
import { useBackend } from "../hooks/useBackend";
import { hashSHA256 } from "../lib/crypto";
import {
  type AttendanceRecord,
  type CompanyTimingRecord,
  type PermissionRecord,
  type SettingsRecord,
  type WorkerRecord,
  dbDeleteWorkerAllData,
  dbGetAllAttendanceByCompany,
  dbGetAllPermissionsByCompany,
  dbGetAllWorkersByCompany,
  dbGetManager,
  dbGetSettings,
  dbGetTiming,
  dbPutManager,
  dbPutSettings,
  dbPutTiming,
  dbPutWorker,
  dbUpdatePermissionStatus,
} from "../lib/db";
import {
  averageEmbeddings,
  extractEmbedding,
  loadFaceModels,
} from "../lib/faceRecognition";
import {
  type ReportRange,
  generateReport,
  generateWorkerReport,
} from "../lib/pdfExport";
import { onSyncRefresh } from "../lib/sync";

type Section =
  | "overview"
  | "workers"
  | "attendance"
  | "permissions"
  | "reports"
  | "settings";

const NAV_ITEMS: { key: Section; label: string; icon: React.ReactNode }[] = [
  {
    key: "overview",
    label: "Dashboard",
    icon: <LayoutDashboard className="w-4 h-4" />,
  },
  { key: "workers", label: "Employees", icon: <Users className="w-4 h-4" /> },
  {
    key: "attendance",
    label: "Attendance",
    icon: <CalendarDays className="w-4 h-4" />,
  },
  { key: "permissions", label: "Permissions", icon: <ClipboardIcon /> },
  { key: "reports", label: "Reports", icon: <FileText className="w-4 h-4" /> },
  {
    key: "settings",
    label: "Settings",
    icon: <Settings className="w-4 h-4" />,
  },
];

function ClipboardIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <title>Clipboard</title>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    </svg>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "present"
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : s === "absent"
        ? "bg-red-500/20 text-red-400 border-red-500/30"
        : s === "permission"
          ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
          : s === "approved"
            ? "bg-green-500/20 text-green-400 border-green-500/30"
            : s === "rejected"
              ? "bg-red-500/20 text-red-400 border-red-500/30"
              : s === "pending"
                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function KpiCard({
  title,
  value,
  icon,
  trend,
  gradientClass,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  trend?: string;
  gradientClass?: string;
}) {
  return (
    <div
      className={`rounded-xl p-4 sm:p-5 border border-border flex items-center gap-3 sm:gap-4 ${gradientClass ?? "bg-card"}`}
    >
      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-white/70 font-medium uppercase tracking-wider">
          {title}
        </p>
        <p className="text-2xl sm:text-3xl font-bold text-white mt-0.5">
          {value}
        </p>
        {trend && <p className="text-xs text-white/60 mt-1">{trend}</p>}
      </div>
    </div>
  );
}

// --- Enroll Modal ---
type EnrollStep = 1 | 2 | 3;
const _ANGLES = ["Front", "Left", "Right"] as const;

function EnrollModal({
  open,
  onClose,
  onSave,
  editWorker,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (w: WorkerRecord) => Promise<void>;
  editWorker?: WorkerRecord;
}) {
  const [step, setStep] = useState<EnrollStep>(1);
  const [name, setName] = useState(editWorker?.name ?? "");
  const [id, setId] = useState(editWorker?.id ?? "");
  const [dept, setDept] = useState(editWorker?.department ?? "");
  const [phone, setPhone] = useState(editWorker?.phone ?? "");
  const [capturedEmbeddings, setCapturedEmbeddings] = useState<Float32Array[]>(
    [],
  );
  const [currentAngle, setCurrentAngle] = useState(0);
  const [captureStatus, setCaptureStatus] = useState<
    "idle" | "capturing" | "captured"
  >("idle");
  const [modelsReady, setModelsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isEdit = !!editWorker;

  useEffect(() => {
    if (open) {
      setStep(isEdit ? 1 : 1);
      setName(editWorker?.name ?? "");
      setId(editWorker?.id ?? "");
      setDept(editWorker?.department ?? "");
      setPhone(editWorker?.phone ?? "");
      setCapturedEmbeddings([]);
      setCurrentAngle(0);
    }
  }, [open, editWorker, isEdit]);

  const startCamera = useCallback(async () => {
    await loadFaceModels().then((ok) => setModelsReady(ok));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      toast.error("Camera access denied");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) {
        t.stop();
      }
    }
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (step === 2 && !isEdit) {
      startCamera();
    } else {
      stopCamera();
    }
    return stopCamera;
  }, [step, isEdit, startCamera, stopCamera]);

  // Auto-capture: trigger captureAngle after 2s delay when face models ready
  useEffect(() => {
    if (
      step !== 2 ||
      isEdit ||
      !modelsReady ||
      captureStatus !== "idle" ||
      capturedEmbeddings.length >= 3
    )
      return;
    const timer = setTimeout(() => {
      captureAngle();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isEdit, modelsReady, captureStatus, capturedEmbeddings.length]);

  const captureAngle = async () => {
    if (!videoRef.current) return;
    setCaptureStatus("capturing");
    const emb = await extractEmbedding(videoRef.current);
    if (!emb) {
      toast.error("No face detected. Adjust position and try again.");
      setCaptureStatus("idle");
      return;
    }
    const updated = [...capturedEmbeddings, emb];
    setCapturedEmbeddings(updated);
    setCaptureStatus("captured");
    await new Promise((r) => setTimeout(r, 600));
    if (currentAngle < 2) {
      setCurrentAngle((a) => a + 1);
      setCaptureStatus("idle");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let faceEmbeddings = editWorker?.faceEmbeddings ?? new Float32Array(128);
      if (!isEdit && capturedEmbeddings.length > 0) {
        faceEmbeddings = await averageEmbeddings(capturedEmbeddings);
      }
      await onSave({
        id,
        companyId: editWorker?.companyId ?? "",
        name,
        department: dept,
        phone,
        faceEmbeddings,
        enrolledAt: editWorker?.enrolledAt ?? Date.now(),
      });
    } finally {
      setSaving(false);
    }
  };

  const step1Valid = name && id && dept && phone;
  const step2Valid = isEdit || capturedEmbeddings.length === 3;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="bg-card border-border text-foreground w-[95vw] max-w-md max-h-[85vh] overflow-y-auto"
        data-ocid="enroll.dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Worker" : "Enroll New Worker"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        {!isEdit && (
          <div className="flex gap-2 mb-2">
            {([1, 2, 3] as const).map((s) => (
              <div
                key={s}
                className={`flex-1 h-1 rounded-full transition-colors ${
                  step >= s ? "bg-brand" : "bg-border"
                }`}
              />
            ))}
          </div>
        )}

        {/* Step 1: Info */}
        {(step === 1 || isEdit) && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Full Name
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 bg-input border-border"
                  data-ocid="enroll.name.input"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Worker ID
                </Label>
                <Input
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  className="mt-1 bg-input border-border"
                  disabled={isEdit}
                  data-ocid="enroll.id.input"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Department
                </Label>
                <Input
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  className="mt-1 bg-input border-border"
                  data-ocid="enroll.dept.input"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Phone</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 bg-input border-border"
                  data-ocid="enroll.phone.input"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Face Capture - Biometric Scanner UI */}
        {step === 2 && !isEdit && (
          <div className="space-y-4 flex flex-col items-center">
            {!modelsReady ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Loading face models...
                </p>
              </div>
            ) : capturedEmbeddings.length === 3 ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <div className="w-20 h-20 rounded-full bg-green-500/20 border-2 border-green-400 flex items-center justify-center">
                  <Check className="w-10 h-10 text-green-400" />
                </div>
                <p className="text-base font-semibold text-green-400">
                  Face scan complete
                </p>
                <p className="text-xs text-muted-foreground">
                  All 3 angles captured successfully
                </p>
              </div>
            ) : (
              <>
                {/* Biometric scanner square container — responsive size */}
                <div
                  className="mx-auto relative rounded-2xl overflow-hidden bg-black"
                  style={{
                    width: "min(80vw, 288px)",
                    height: "min(80vw, 288px)",
                  }}
                >
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{ transform: "scaleX(-1)" }}
                  />
                  {/* Oval face guide overlay */}
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 288 288"
                    role="img"
                    aria-label="Face alignment guide"
                  >
                    <ellipse
                      cx="144"
                      cy="144"
                      rx="90"
                      ry="115"
                      fill="none"
                      stroke="rgba(99,102,241,0.8)"
                      strokeWidth="3"
                      strokeDasharray="8 4"
                      style={{ animation: "pulse 2s ease-in-out infinite" }}
                    />
                    {/* Corner brackets */}
                    <path
                      d="M54,60 L54,40 L74,40"
                      fill="none"
                      stroke="rgba(99,102,241,1)"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <path
                      d="M234,60 L234,40 L214,40"
                      fill="none"
                      stroke="rgba(99,102,241,1)"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <path
                      d="M54,228 L54,248 L74,248"
                      fill="none"
                      stroke="rgba(99,102,241,1)"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <path
                      d="M234,228 L234,248 L214,248"
                      fill="none"
                      stroke="rgba(99,102,241,1)"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                  {/* Scanning line */}
                  {captureStatus !== "capturing" && (
                    <div
                      className="absolute left-7 right-7 h-0.5 bg-gradient-to-r from-transparent via-brand to-transparent opacity-80 pointer-events-none"
                      style={{
                        animation: "scanLine 2s ease-in-out infinite",
                        top: "25%",
                      }}
                    />
                  )}
                  {/* Green flash on capture */}
                  {captureStatus === "captured" && (
                    <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                      <Check className="w-10 h-10 text-green-400 drop-shadow-lg" />
                    </div>
                  )}
                  {/* Capturing indicator */}
                  {captureStatus === "capturing" && (
                    <div className="absolute inset-0 bg-brand/10 flex items-center justify-center">
                      <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                {/* Dynamic instruction text */}
                <p className="text-sm text-center font-medium text-foreground">
                  {currentAngle === 0 && "Hold still — looking straight"}
                  {currentAngle === 1 && "Slowly turn your head LEFT"}
                  {currentAngle === 2 && "Slowly turn your head RIGHT"}
                </p>
                <p className="text-xs text-muted-foreground text-center">
                  Auto-capturing in a moment... stay still
                </p>

                {/* Progress dots */}
                <div className="flex gap-3 justify-center">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full border-2 transition-all duration-300 ${
                        i < capturedEmbeddings.length
                          ? "bg-green-400 border-green-400"
                          : i === currentAngle
                            ? "border-brand animate-pulse bg-brand/30"
                            : "border-border bg-transparent"
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
            <style>{`
              @keyframes scanLine {
                0% { top: 25%; opacity: 0; }
                10% { opacity: 0.8; }
                90% { opacity: 0.8; }
                100% { top: 75%; opacity: 0; }
              }
            `}</style>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && !isEdit && (
          <div className="space-y-3">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <p className="text-green-400 font-semibold text-sm">
                Ready to Save
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                3 face angles captured &bull; {name} &bull; {id} &bull; {dept}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-border"
            data-ocid="enroll.cancel.button"
          >
            Cancel
          </Button>
          {isEdit ? (
            <Button
              className="bg-brand hover:bg-brand-dark text-white"
              onClick={handleSave}
              disabled={saving || !step1Valid}
              data-ocid="enroll.save.button"
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          ) : step === 1 ? (
            <Button
              className="bg-brand hover:bg-brand-dark text-white"
              onClick={() => setStep(2)}
              disabled={!step1Valid}
              data-ocid="enroll.next.button"
            >
              Next: Face Capture
            </Button>
          ) : step === 2 ? (
            <Button
              className="bg-brand hover:bg-brand-dark text-white"
              onClick={() => setStep(3)}
              disabled={!step2Valid}
              data-ocid="enroll.next.button"
            >
              Next: Confirm
            </Button>
          ) : (
            <Button
              className="bg-brand hover:bg-brand-dark text-white"
              onClick={handleSave}
              disabled={saving}
              data-ocid="enroll.save.button"
            >
              {saving ? "Saving..." : "Enroll Worker"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== AI ASSISTANT =====
function AIAssistant({
  workers,
  attendance,
  permissions,
}: {
  workers: WorkerRecord[];
  attendance: AttendanceRecord[];
  permissions: PermissionRecord[];
}) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const today = new Date().toISOString().split("T")[0];

  const getAnswer = (q: string): string => {
    const todayAtt = attendance.filter((a) => a.date === today);
    const presentIds = new Set(
      todayAtt.filter((a) => a.status === "present").map((a) => a.workerId),
    );

    // --- Today presence ---
    if (
      q.includes("how many present") ||
      q.includes("present today") ||
      q.includes("who is present")
    ) {
      const names = workers
        .filter((w) => presentIds.has(w.id))
        .map((w) => w.name);
      return names.length === 0
        ? "No workers are present today."
        : `${names.length} worker${names.length !== 1 ? "s" : ""} present today: ${names.join(", ")}.`;
    }
    if (
      q.includes("absent today") ||
      q.includes("who is absent") ||
      q.includes("not present")
    ) {
      const absent = workers.filter((w) => !presentIds.has(w.id));
      return absent.length === 0
        ? "All workers are present today! 🎉"
        : `${absent.length} absent today: ${absent.map((w) => w.name).join(", ")}.`;
    }
    if (q.includes("checked in") || q.includes("who checked in")) {
      const list = todayAtt
        .filter((a) => a.checkIn)
        .map((a) => {
          const w = workers.find((x) => x.id === a.workerId);
          return `${w?.name ?? a.workerId} (${new Date(a.checkIn!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
        });
      return list.length === 0
        ? "No one has checked in today."
        : `Checked in today: ${list.join(", ")}.`;
    }
    if (q.includes("checked out") || q.includes("who checked out")) {
      const list = todayAtt
        .filter((a) => a.checkOut)
        .map((a) => {
          const w = workers.find((x) => x.id === a.workerId);
          return `${w?.name ?? a.workerId} (${new Date(a.checkOut!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
        });
      return list.length === 0
        ? "No one has checked out yet."
        : `Checked out: ${list.join(", ")}.`;
    }
    if (
      q.includes("not checked out") ||
      q.includes("still in") ||
      q.includes("still working")
    ) {
      const list = todayAtt
        .filter((a) => a.checkIn && !a.checkOut)
        .map((a) => {
          const w = workers.find((x) => x.id === a.workerId);
          return w?.name ?? a.workerId;
        });
      return list.length === 0
        ? "Everyone has checked out."
        : `Still working: ${list.join(", ")} (${list.length} worker${list.length !== 1 ? "s" : ""}).`;
    }

    // --- Late / Delay ---
    if (
      q.includes("most late") ||
      q.includes("most delayed") ||
      q.includes("top delay")
    ) {
      const lateAtt = todayAtt.filter((a) => (a.delay_minutes ?? 0) > 0);
      if (lateAtt.length === 0) return "No late arrivals today.";
      const top = lateAtt.reduce((a, b) =>
        (a.delay_minutes ?? 0) > (b.delay_minutes ?? 0) ? a : b,
      );
      const w = workers.find((x) => x.id === top.workerId);
      return `Most delayed today: ${w?.name ?? top.workerId} with ${formatMinutes(top.delay_minutes ?? 0)} delay.`;
    }
    if (q.includes("average delay")) {
      const lateAtt = todayAtt.filter((a) => (a.delay_minutes ?? 0) > 0);
      if (lateAtt.length === 0) return "No delays recorded today.";
      const avg =
        lateAtt.reduce((s, a) => s + (a.delay_minutes ?? 0), 0) /
        lateAtt.length;
      return `Average delay today: ${formatMinutes(Math.round(avg))} across ${lateAtt.length} late worker${lateAtt.length !== 1 ? "s" : ""}.`;
    }
    if (
      q.includes("late today") ||
      q.includes("delay today") ||
      q.includes("who is late") ||
      q.includes("late") ||
      q.includes("delay")
    ) {
      const lateAtt = todayAtt.filter((a) => (a.delay_minutes ?? 0) > 0);
      if (lateAtt.length === 0) return "No late arrivals today. ✅";
      const names = lateAtt.map((a) => {
        const w = workers.find((x) => x.id === a.workerId);
        return `${w?.name ?? a.workerId} (${a.delay_minutes}min)`;
      });
      return `${lateAtt.length} late today: ${names.join(", ")}.`;
    }

    // --- Overtime ---
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    if (q.includes("most overtime") || q.includes("top overtime")) {
      const weekAtt = attendance.filter((a) => a.date >= weekStartStr);
      const otByWorker: Record<string, number> = {};
      for (const a of weekAtt)
        otByWorker[a.workerId] =
          (otByWorker[a.workerId] ?? 0) + (a.overtime_minutes ?? 0);
      const top = Object.entries(otByWorker).sort((a, b) => b[1] - a[1])[0];
      if (!top || top[1] === 0) return "No overtime recorded this week.";
      const w = workers.find((x) => x.id === top[0]);
      return `Top overtime this week: ${w?.name ?? top[0]} with ${formatMinutes(top[1])} overtime.`;
    }
    if (q.includes("overtime today") || q.includes("who has overtime today")) {
      const otList = todayAtt.filter((a) => (a.overtime_minutes ?? 0) > 0);
      if (otList.length === 0) return "No overtime recorded today.";
      const names = otList.map((a) => {
        const w = workers.find((x) => x.id === a.workerId);
        return `${w?.name ?? a.workerId} (${a.overtime_minutes}min)`;
      });
      return `${otList.length} worker${otList.length !== 1 ? "s" : ""} with overtime today: ${names.join(", ")}.`;
    }
    if (q.includes("overtime this month") || q.includes("month overtime")) {
      const monthAtt = attendance.filter((a) => a.date >= monthStartStr);
      const total = monthAtt.reduce((s, a) => s + (a.overtime_minutes ?? 0), 0);
      return `Total overtime this month: ${formatMinutes(total)}.`;
    }
    if (q.includes("overtime")) {
      const weekAtt = attendance.filter((a) => a.date >= weekStartStr);
      const total = weekAtt.reduce((s, a) => s + (a.overtime_minutes ?? 0), 0);
      return `Total overtime this week: ${formatMinutes(total)}.`;
    }

    // --- Permissions ---
    if (q.includes("pending permission") || q.includes("pending requests")) {
      const pending = permissions.filter((p) => p.status === "pending");
      const names = pending.map((p) => {
        const w = workers.find((x) => x.id === p.workerId);
        return w?.name ?? p.workerId;
      });
      return pending.length === 0
        ? "No pending permissions."
        : `${pending.length} pending: ${names.join(", ")}.`;
    }
    if (q.includes("approved permission")) {
      const approved = permissions.filter((p) => p.status === "approved");
      const names = approved.map((p) => {
        const w = workers.find((x) => x.id === p.workerId);
        return w?.name ?? p.workerId;
      });
      return approved.length === 0
        ? "No approved permissions."
        : `${approved.length} approved: ${names.join(", ")}.`;
    }
    if (q.includes("rejected permission")) {
      const rejected = permissions.filter((p) => p.status === "rejected");
      const names = rejected.map((p) => {
        const w = workers.find((x) => x.id === p.workerId);
        return w?.name ?? p.workerId;
      });
      return rejected.length === 0
        ? "No rejected permissions."
        : `${rejected.length} rejected: ${names.join(", ")}.`;
    }
    if (q.includes("permission today") || q.includes("permission request")) {
      const todayPerms = permissions.filter((p) => {
        const d = new Date(p.createdAt).toISOString().split("T")[0];
        return d === today;
      });
      if (todayPerms.length === 0) return "No permission requests today.";
      const names = todayPerms.map((p) => {
        const w = workers.find((x) => x.id === p.workerId);
        return `${w?.name ?? p.workerId} (${p.status})`;
      });
      return `${todayPerms.length} permission${todayPerms.length !== 1 ? "s" : ""} today: ${names.join(", ")}.`;
    }
    if (q.includes("permission")) {
      const pending = permissions.filter((p) => p.status === "pending").length;
      const approved = permissions.filter(
        (p) => p.status === "approved",
      ).length;
      const rejected = permissions.filter(
        (p) => p.status === "rejected",
      ).length;
      return `Permissions — Pending: ${pending}, Approved: ${approved}, Rejected: ${rejected}.`;
    }

    // --- Worker info ---
    if (
      q.includes("total workers") ||
      q.includes("how many workers") ||
      q.includes("worker count")
    ) {
      return `Total enrolled workers: ${workers.length}.`;
    }
    if (
      q.includes("worker named") ||
      q.includes("find worker") ||
      q.includes("search worker")
    ) {
      const parts = q.split(/worker named|find worker|search worker/);
      const searchTerm = (parts[1] ?? "").trim();
      if (!searchTerm) return "Please specify a name, e.g. 'find worker Ravi'.";
      const found = workers.filter((w) =>
        w.name.toLowerCase().includes(searchTerm),
      );
      if (found.length === 0)
        return `No worker found matching "${searchTerm}".`;
      const results = found.map((w) => {
        const att = todayAtt.find((a) => a.workerId === w.id);
        const status = att
          ? att.checkIn
            ? att.checkOut
              ? "checked out"
              : "checked in"
            : "no record"
          : "absent";
        return `${w.name} — today: ${status}`;
      });
      return results.join(" | ");
    }
    if (q.includes("department")) {
      const hasDept = workers.some(
        (w) => (w as WorkerRecord & { department?: string }).department,
      );
      if (!hasDept)
        return "Department info is not available in worker records.";
      const deptMap: Record<string, string[]> = {};
      for (const w of workers) {
        const dept =
          (w as WorkerRecord & { department?: string }).department ?? "Unknown";
        if (!deptMap[dept]) deptMap[dept] = [];
        deptMap[dept].push(w.name);
      }
      return Object.entries(deptMap)
        .map(([d, names]) => `${d}: ${names.join(", ")}`)
        .join(" | ");
    }

    // --- Weekly / Monthly summaries ---
    if (
      q.includes("this week") ||
      q.includes("week summary") ||
      q.includes("weekly report")
    ) {
      const weekAtt = attendance.filter(
        (a) => a.date >= weekStartStr && a.status === "present",
      );
      const countByWorker: Record<string, number> = {};
      for (const a of weekAtt)
        countByWorker[a.workerId] = (countByWorker[a.workerId] ?? 0) + 1;
      if (Object.keys(countByWorker).length === 0)
        return "No attendance recorded this week.";
      const sorted = Object.entries(countByWorker).sort((a, b) => b[1] - a[1]);
      const topW = workers.find((x) => x.id === sorted[0][0]);
      return `This week — Top attendee: ${topW?.name ?? sorted[0][0]} (${sorted[0][1]} days). ${Object.keys(countByWorker).length} workers attended.`;
    }
    if (
      q.includes("this month") ||
      q.includes("month summary") ||
      q.includes("monthly report")
    ) {
      const monthAtt = attendance.filter(
        (a) => a.date >= monthStartStr && a.status === "present",
      );
      const countByWorker: Record<string, number> = {};
      for (const a of monthAtt)
        countByWorker[a.workerId] = (countByWorker[a.workerId] ?? 0) + 1;
      if (Object.keys(countByWorker).length === 0)
        return "No attendance recorded this month.";
      const sorted = Object.entries(countByWorker).sort((a, b) => b[1] - a[1]);
      const topW = workers.find((x) => x.id === sorted[0][0]);
      return `This month — Top attendee: ${topW?.name ?? sorted[0][0]} (${sorted[0][1]} days). ${Object.keys(countByWorker).length} workers attended.`;
    }
    if (q.includes("attendance rate") || q.includes("attendance percentage")) {
      if (workers.length === 0) return "No workers enrolled.";
      const rate = ((presentIds.size / workers.length) * 100).toFixed(1);
      return `Attendance rate today: ${rate}% (${presentIds.size} of ${workers.length} workers present).`;
    }

    // --- Shift / Timing ---
    if (
      q.includes("work hours") ||
      q.includes("shift time") ||
      q.includes("timing")
    ) {
      return "Work hours and shift timing can be configured in Manager Settings → Company Timing.";
    }

    // --- Help ---
    return [
      "I can answer questions like:",
      "• Who is present/absent today?",
      "• Who checked in / checked out?",
      "• Late workers today / Average delay",
      "• Overtime today / this week / this month",
      "• Pending permissions / Permission list today",
      "• Total workers / Find worker [name]",
      "• Attendance rate / Week summary / Month summary",
    ].join("\n");
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
    "Who is absent?",
    "Late workers today",
    "Total overtime this week",
    "Pending permissions",
    "Attendance rate",
  ];

  return (
    <div
      className="bg-card border border-brand/30 rounded-xl p-4 sm:p-5"
      data-ocid="overview.ai_assistant.panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center">
          <span className="text-brand text-xs font-bold">AI</span>
        </div>
        <h3 className="text-foreground font-semibold text-sm">AI Assistant</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          Offline · Instant
        </span>
      </div>

      {/* Chat history */}
      <div
        className="max-h-48 overflow-y-auto flex flex-col gap-2 mb-3 pr-1"
        data-ocid="overview.ai_assistant.panel"
      >
        {history.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Ask a question about attendance below.
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
                data-ocid="overview.ai_assistant.success_state"
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
              data-ocid="overview.ai_assistant.button"
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
          placeholder="Ask e.g. 'How many present today?'"
          className="flex-1 bg-input border-border text-sm"
          data-ocid="overview.ai_assistant.input"
        />
        <Button
          onClick={() => handleAsk()}
          className="bg-brand hover:bg-brand-dark text-white px-4"
          data-ocid="overview.ai_assistant.button"
        >
          Ask
        </Button>
        <Button
          onClick={handleClear}
          variant="outline"
          className="px-3"
          data-ocid="overview.ai_assistant.secondary_button"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

// ===== MAIN DASHBOARD =====

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

export default function ManagerDashboard() {
  const { managerName, logout, selectedCompany } = useAuth();
  const [section, setSection] = useState<Section>("overview");
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshData = useCallback(async () => {
    const [w, a, p, s] = await Promise.all([
      dbGetAllWorkersByCompany(selectedCompany?.id ?? ""),
      dbGetAllAttendanceByCompany(selectedCompany?.id ?? ""),
      dbGetAllPermissionsByCompany(selectedCompany?.id ?? ""),
      dbGetSettings(selectedCompany?.id),
    ]);
    setWorkers(w);
    setAttendance(a);
    setPermissions(p);
    setSettings(s ?? null);
  }, [selectedCompany?.id]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Auto-refresh when sync service updates IndexedDB
  useEffect(() => {
    const unsub = onSyncRefresh(refreshData);
    return unsub;
  }, [refreshData]);

  const todayAtt = attendance.filter((a) => a.date === today);
  const presentToday = todayAtt.filter((a) => a.status === "present").length;
  const absentToday = Math.max(0, workers.length - presentToday);
  const pendingPerms = permissions.filter((p) => p.status === "pending").length;

  const workerName = (id: string) =>
    workers.find((w) => w.id === id)?.name ?? id;

  const handleNavSelect = (key: Section) => {
    setSection(key);
    setMobileMenuOpen(false);
  };

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #0B1220 0%, #101A2A 100%)",
      }}
    >
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 ${
          sidebarCollapsed ? "w-16" : "w-56"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 p-4 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0">
            {selectedCompany ? (
              <img
                src={COMPANY_LOGOS[selectedCompany.id]}
                alt={`${selectedCompany.name} logo`}
                className="w-8 h-8 object-contain"
              />
            ) : (
              <ScanFace className="w-5 h-5 text-brand" />
            )}
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-brand tracking-widest whitespace-nowrap">
                FACEID ATTENDANCE
              </span>
              {selectedCompany && (
                <span className="text-[10px] text-muted-foreground/70 truncate max-w-[140px] mt-0.5">
                  {selectedCompany.name}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.key}
              onClick={() => setSection(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                section === item.key
                  ? "bg-brand/15 text-brand border border-brand/30"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
              data-ocid={`nav.${item.key}.link`}
            >
              {item.icon}
              {!sidebarCollapsed && (
                <span className="font-medium">{item.label}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed((c) => !c)}
          className="m-2 p-2 rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors flex items-center justify-center"
          data-ocid="sidebar.toggle.button"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={logout}
          className="m-2 p-2 flex items-center gap-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
          data-ocid="manager.logout.button"
        >
          <LogOut className="w-4 h-4" />
          {!sidebarCollapsed && "Logout"}
        </button>
      </aside>

      {/* Mobile Nav Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="left"
          className="w-64 bg-sidebar border-sidebar-border p-0"
        >
          <SheetHeader className="flex items-center gap-3 p-4 border-b border-sidebar-border">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0">
              {selectedCompany ? (
                <img
                  src={COMPANY_LOGOS[selectedCompany.id]}
                  alt={`${selectedCompany.name} logo`}
                  className="w-8 h-8 object-contain"
                />
              ) : (
                <ScanFace className="w-5 h-5 text-brand" />
              )}
            </div>
            <SheetTitle className="text-xs font-bold text-brand tracking-widest">
              FACEID ATTENDANCE
            </SheetTitle>
          </SheetHeader>
          <nav className="flex-1 p-2 space-y-1 mt-2">
            {NAV_ITEMS.map((item) => (
              <button
                type="button"
                key={item.key}
                onClick={() => handleNavSelect(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                  section === item.key
                    ? "bg-brand/15 text-brand border border-brand/30"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
                data-ocid={`mobile.nav.${item.key}.link`}
              >
                {item.icon}
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="p-2 border-t border-sidebar-border mt-4">
            <button
              type="button"
              onClick={logout}
              className="w-full p-2 flex items-center gap-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
              data-ocid="manager.mobile.logout.button"
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border bg-card/40 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Hamburger - mobile only */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0"
              data-ocid="manager.menu.button"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-foreground truncate">
                {NAV_ITEMS.find((n) => n.key === section)?.label ?? "Dashboard"}
              </h1>
              <p className="text-muted-foreground text-xs sm:text-sm hidden sm:block">
                Hi, {managerName}!
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <SyncIndicator />
            <div className="text-right hidden sm:block">
              <p className="text-xs text-muted-foreground">{today}</p>
              <p className="text-sm font-mono text-foreground">
                {currentTime.toLocaleTimeString()}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="border-border text-muted-foreground hover:text-red-400 hover:bg-red-500/10 gap-1 hidden sm:flex"
              data-ocid="manager.header.logout.button"
            >
              <LogOut className="w-4 h-4" /> Logout
            </Button>
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-brand/20 border border-brand/40 flex items-center justify-center text-brand font-bold text-sm">
              {managerName.charAt(0)}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
          {section === "overview" && (
            <OverviewSection
              workers={workers}
              presentToday={presentToday}
              absentToday={absentToday}
              pendingPerms={pendingPerms}
              attendance={attendance}
              today={today}
              workerName={workerName}
              permissions={permissions}
            />
          )}
          {section === "workers" && (
            <WorkersSection workers={workers} onRefresh={refreshData} />
          )}
          {section === "attendance" && (
            <AttendanceSection attendance={attendance} workers={workers} />
          )}
          {section === "permissions" && (
            <PermissionsSection
              permissions={permissions}
              workers={workers}
              onRefresh={refreshData}
            />
          )}
          {section === "reports" && (
            <ReportsSection
              workers={workers}
              attendance={attendance}
              permissions={permissions}
              companyName={selectedCompany?.name}
            />
          )}
          {section === "settings" && (
            <SettingsSection settings={settings} onRefresh={refreshData} />
          )}
        </main>
      </div>
    </div>
  );
}

// ===== OVERVIEW SECTION =====
function OverviewSection({
  workers,
  presentToday,
  absentToday,
  pendingPerms,
  attendance,
  today,
  workerName,
  permissions,
}: {
  workers: WorkerRecord[];
  presentToday: number;
  absentToday: number;
  pendingPerms: number;
  attendance: AttendanceRecord[];
  today: string;
  workerName: (id: string) => string;
  permissions: PermissionRecord[];
}) {
  const todayAtt = attendance.filter((a) => a.date === today);
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          title="Total Employees"
          value={workers.length}
          icon={<Users className="w-5 h-5 sm:w-6 sm:h-6 text-white" />}
          trend="Enrolled workers"
          gradientClass="bg-gradient-to-br from-[#1A2B44] to-[#1F3356]"
        />
        <KpiCard
          title="Present Today"
          value={presentToday}
          icon={<Check className="w-5 h-5 sm:w-6 sm:h-6 text-white" />}
          trend={`${workers.length ? Math.round((presentToday / workers.length) * 100) : 0}% attendance`}
          gradientClass="bg-gradient-to-br from-[#1D5A4A] to-[#2AAE7C]"
        />
        <KpiCard
          title="Absent Today"
          value={absentToday}
          icon={<X className="w-5 h-5 sm:w-6 sm:h-6 text-white" />}
          trend="Not checked in"
          gradientClass="bg-gradient-to-br from-[#5A2330] to-[#B24A5A]"
        />
        <KpiCard
          title="Pending Perms"
          value={pendingPerms}
          icon={<ClipboardIcon />}
          trend="Awaiting approval"
          gradientClass="bg-gradient-to-br from-[#4A3A1A] to-[#9E7A2A]"
        />
      </div>

      {/* Today's activity */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
        <h3 className="text-foreground font-semibold mb-4">
          Today&apos;s Activity
        </h3>
        {todayAtt.length === 0 ? (
          <p
            className="text-muted-foreground text-sm"
            data-ocid="overview.activity.empty_state"
          >
            No check-ins recorded today.
          </p>
        ) : (
          <div className="space-y-2">
            {todayAtt.map((a, i) => (
              <div
                key={a.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border"
                data-ocid={`overview.activity.item.${i + 1}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center text-brand text-sm font-bold flex-shrink-0">
                    {workerName(a.workerId).charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">
                      {workerName(a.workerId)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      In: {new Date(a.checkIn).toLocaleTimeString()}
                      {a.checkOut &&
                        ` | Out: ${new Date(a.checkOut).toLocaleTimeString()}`}
                    </p>
                  </div>
                </div>
                <StatusPill status={a.status} />
              </div>
            ))}
          </div>
        )}
      </div>
      <AIAssistant
        workers={workers}
        attendance={attendance}
        permissions={permissions}
      />
    </div>
  );
}

// ===== WORKERS SECTION =====
function WorkersSection({
  workers,
  onRefresh,
}: { workers: WorkerRecord[]; onRefresh: () => void }) {
  const { selectedCompany } = useAuth();
  const { actor } = useBackend();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [editWorker, setEditWorker] = useState<WorkerRecord | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = workers.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.id.toLowerCase().includes(search.toLowerCase()) ||
      w.department.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSave = async (w: WorkerRecord) => {
    const companyId = selectedCompany?.id ?? "";
    const savedWorker: WorkerRecord = { ...w, companyId };
    await dbPutWorker(savedWorker);
    // Also sync to backend
    if (actor && !editWorker) {
      try {
        // Convert Float32Array embeddings to Uint8Array for backend
        const embBytes = new Uint8Array(savedWorker.faceEmbeddings.buffer);
        await actor.addWorker(
          companyId,
          savedWorker.id,
          savedWorker.name,
          savedWorker.department,
          savedWorker.phone,
          embBytes,
        );
      } catch (e) {
        console.warn("[Backend] addWorker failed:", e);
      }
    } else if (actor && editWorker) {
      try {
        await actor.updateWorker(
          companyId,
          savedWorker.id,
          savedWorker.name,
          savedWorker.department,
          savedWorker.phone,
        );
      } catch (e) {
        console.warn("[Backend] updateWorker failed:", e);
      }
    }
    onRefresh();
    setEnrollOpen(false);
    setEditWorker(undefined);
    toast.success(
      editWorker ? "Worker updated" : "Worker enrolled successfully",
    );
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const companyId = selectedCompany?.id ?? "";
    await dbDeleteWorkerAllData(deleteId);
    // Also delete from backend
    if (actor) {
      try {
        await actor.deleteWorker(companyId, deleteId);
      } catch (e) {
        console.warn("[Backend] deleteWorker failed:", e);
      }
    }
    onRefresh();
    setDeleteId(null);
    toast.success("Worker and all related records removed");
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search workers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] max-w-xs bg-input border-border"
          data-ocid="workers.search.input"
        />
        <Button
          className="bg-brand hover:bg-brand-dark text-white flex-shrink-0"
          onClick={() => {
            setEditWorker(undefined);
            setEnrollOpen(true);
          }}
          data-ocid="workers.add.button"
        >
          <Plus className="w-4 h-4 mr-2" /> Add Worker
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Worker",
                  "ID",
                  "Department",
                  "Phone",
                  "Enrolled",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-xs text-muted-foreground font-semibold uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground text-sm"
                    data-ocid="workers.table.empty_state"
                  >
                    No workers found.
                  </td>
                </tr>
              ) : (
                filtered.map((w, i) => (
                  <tr
                    key={w.id}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                    data-ocid={`workers.table.row.${i + 1}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center text-brand text-sm font-bold flex-shrink-0">
                          {w.name.charAt(0)}
                        </div>
                        <span className="text-sm text-foreground">
                          {w.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {w.id}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {w.department}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {w.phone}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(w.enrolledAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditWorker(w);
                            setEnrollOpen(true);
                          }}
                          className="text-muted-foreground hover:text-brand p-1 h-auto"
                          data-ocid={`workers.edit_button.${i + 1}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(w.id)}
                          className="text-muted-foreground hover:text-red-400 p-1 h-auto"
                          data-ocid={`workers.delete_button.${i + 1}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EnrollModal
        open={enrollOpen}
        onClose={() => {
          setEnrollOpen(false);
          setEditWorker(undefined);
        }}
        onSave={handleSave}
        editWorker={editWorker}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent
          className="bg-card border-border text-foreground w-[95vw] max-w-sm max-h-[85vh] overflow-y-auto"
          data-ocid="workers.delete.dialog"
        >
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Are you sure you want to remove this worker? This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteId(null)}
              className="border-border"
              data-ocid="workers.delete.cancel_button"
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDelete}
              data-ocid="workers.delete.confirm_button"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== ATTENDANCE SECTION =====
function AttendanceSection({
  attendance,
  workers,
}: { attendance: AttendanceRecord[]; workers: WorkerRecord[] }) {
  const [filterWorker, setFilterWorker] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDate, setFilterDate] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const filtered = attendance
    .filter((a) => filterWorker === "all" || a.workerId === filterWorker)
    .filter((a) => filterStatus === "all" || a.status === filterStatus)
    .filter((a) => !filterDate || a.date === filterDate)
    .sort((a, b) => b.checkIn - a.checkIn);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const workerName = (id: string) =>
    workers.find((w) => w.id === id)?.name ?? id;
  const workerDept = (id: string) =>
    workers.find((w) => w.id === id)?.department ?? "";

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <Select value={filterWorker} onValueChange={setFilterWorker}>
          <SelectTrigger
            className="w-full sm:w-44 bg-input border-border"
            data-ocid="attendance.worker.select"
          >
            <SelectValue placeholder="All Workers" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="all">All Workers</SelectItem>
            {workers.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger
            className="w-full sm:w-36 bg-input border-border"
            data-ocid="attendance.status.select"
          >
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="present">Present</SelectItem>
            <SelectItem value="absent">Absent</SelectItem>
            <SelectItem value="permission">Permission</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="w-full sm:w-44 bg-input border-border"
          data-ocid="attendance.date.input"
        />
        <Button
          variant="outline"
          onClick={() => {
            setFilterWorker("all");
            setFilterStatus("all");
            setFilterDate("");
          }}
          className="border-border text-muted-foreground"
        >
          Clear
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Worker",
                  "Department",
                  "Date",
                  "Check In",
                  "Check Out",
                  "Hours",
                  "Delay",
                  "Early Leave",
                  "Overtime",
                  "Status",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left px-2 sm:px-4 py-3 text-xs text-muted-foreground font-semibold uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="text-center py-8 text-muted-foreground text-sm"
                    data-ocid="attendance.table.empty_state"
                  >
                    No records found.
                  </td>
                </tr>
              ) : (
                paged.map((a, i) => (
                  <tr
                    key={a.id}
                    className="border-b border-border/50 hover:bg-muted/20"
                    data-ocid={`attendance.table.row.${i + 1}`}
                  >
                    <td className="px-2 sm:px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center text-brand text-xs font-bold flex-shrink-0">
                          {workerName(a.workerId).charAt(0)}
                        </div>
                        <span className="text-xs sm:text-sm text-foreground">
                          {workerName(a.workerId)}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-xs sm:text-sm text-muted-foreground">
                      {workerDept(a.workerId)}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-xs sm:text-sm text-muted-foreground">
                      {a.date}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-xs sm:text-sm text-foreground">
                      {new Date(a.checkIn).toLocaleTimeString()}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-xs sm:text-sm text-muted-foreground">
                      {a.checkOut
                        ? new Date(a.checkOut).toLocaleTimeString()
                        : "—"}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-xs sm:text-sm text-muted-foreground">
                      {a.totalHours ? `${a.totalHours.toFixed(1)}h` : "—"}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-xs sm:text-sm text-amber-400">
                      {formatMinutes(a.delay_minutes ?? 0)}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-xs sm:text-sm text-orange-400">
                      {formatMinutes(a.early_leave_minutes ?? 0)}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-xs sm:text-sm text-green-400">
                      {formatMinutes(a.overtime_minutes ?? 0)}
                    </td>
                    <td className="px-2 sm:px-4 py-3">
                      <StatusPill status={a.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{filtered.length} records</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-border"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            data-ocid="attendance.pagination_prev"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-border"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            data-ocid="attendance.pagination_next"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ===== PERMISSIONS SECTION =====
function PermissionsSection({
  permissions,
  workers,
  onRefresh,
}: {
  permissions: PermissionRecord[];
  workers: WorkerRecord[];
  onRefresh: () => void;
}) {
  const { selectedCompany } = useAuth();
  const { actor } = useBackend();
  const [tab, setTab] = useState("pending");
  const workerName = (id: string) =>
    workers.find((w) => w.id === id)?.name ?? id;

  const filtered = permissions
    .filter((p) => p.status === tab)
    .sort((a, b) => b.createdAt - a.createdAt);

  const handleStatus = async (id: string, status: "approved" | "rejected") => {
    await dbUpdatePermissionStatus(id, status);
    // Sync status change to backend so other devices see it
    if (actor) {
      try {
        await actor.updatePermissionStatus(
          selectedCompany?.id ?? "",
          id,
          status,
        );
      } catch (e) {
        console.warn("[Backend] updatePermissionStatus failed:", e);
      }
    }
    onRefresh();
    toast.success(`Permission ${status}`);
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-card border border-border">
          <TabsTrigger
            value="pending"
            className="data-[state=active]:bg-brand/10 data-[state=active]:text-brand"
            data-ocid="permissions.pending.tab"
          >
            Pending
          </TabsTrigger>
          <TabsTrigger
            value="approved"
            className="data-[state=active]:bg-brand/10 data-[state=active]:text-brand"
            data-ocid="permissions.approved.tab"
          >
            Approved
          </TabsTrigger>
          <TabsTrigger
            value="rejected"
            className="data-[state=active]:bg-brand/10 data-[state=active]:text-brand"
            data-ocid="permissions.rejected.tab"
          >
            Rejected
          </TabsTrigger>
        </TabsList>

        {["pending", "approved", "rejected"].map((t) => (
          <TabsContent key={t} value={t} className="mt-4">
            {filtered.length === 0 ? (
              <div
                className="bg-card border border-border rounded-xl p-8 text-center"
                data-ocid="permissions.list.empty_state"
              >
                <p className="text-muted-foreground text-sm">
                  No {t} requests.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((p, i) => (
                  <div
                    key={p.id}
                    className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-start sm:items-center justify-between gap-3"
                    data-ocid={`permissions.list.item.${i + 1}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-foreground font-medium text-sm">
                          {workerName(p.workerId)}
                        </span>
                        <StatusPill status={p.status} />
                      </div>
                      <p className="text-muted-foreground text-sm break-words">
                        {p.reason}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {p.hours}h &bull;{" "}
                        {new Date(p.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {t === "pending" && (
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white min-h-[36px]"
                          onClick={() => handleStatus(p.id, "approved")}
                          data-ocid={`permissions.approve.button.${i + 1}`}
                        >
                          <Check className="w-4 h-4 sm:mr-1" />
                          <span className="hidden sm:inline">Approve</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-500/40 text-red-400 hover:bg-red-500/10 min-h-[36px]"
                          onClick={() => handleStatus(p.id, "rejected")}
                          data-ocid={`permissions.reject.button.${i + 1}`}
                        >
                          <X className="w-4 h-4 sm:mr-1" />
                          <span className="hidden sm:inline">Reject</span>
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ===== REPORTS SECTION =====
function ReportsSection({
  workers,
  attendance,
  permissions,
  companyName,
}: {
  workers: WorkerRecord[];
  attendance: AttendanceRecord[];
  permissions: PermissionRecord[];
  companyName?: string;
}) {
  const { role } = useAuth();
  const [range, setRange] = useState<ReportRange>("monthly");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const [generating, setGenerating] = useState(false);

  const handleRangeChange = (r: ReportRange) => {
    setRange(r);
    const now = new Date();
    if (r === "weekly") {
      const day = now.getDay();
      const start = new Date(now);
      start.setDate(now.getDate() - day);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(now.toISOString().split("T")[0]);
    } else if (r === "monthly") {
      setStartDate(
        new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .split("T")[0],
      );
      setEndDate(now.toISOString().split("T")[0]);
    } else {
      setStartDate(
        new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0],
      );
      setEndDate(now.toISOString().split("T")[0]);
    }
  };

  const handleExport = async () => {
    if (role !== "manager") {
      toast.error("Access denied. Manager authentication required.");
      return;
    }
    setGenerating(true);
    try {
      await generateReport(
        workers,
        attendance,
        permissions,
        range,
        startDate,
        endDate,
        companyName,
      );
      toast.success("PDF report downloaded!");
    } catch (e) {
      toast.error("Failed to generate report");
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
        <h3 className="text-foreground font-semibold mb-4">Generate Report</h3>
        <div className="flex flex-wrap gap-4 mb-5">
          <div>
            <Label className="text-xs text-muted-foreground">Report Type</Label>
            <div className="flex gap-2 mt-1">
              {(["weekly", "monthly", "yearly"] as ReportRange[]).map((r) => (
                <Button
                  key={r}
                  variant={range === r ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleRangeChange(r)}
                  className={
                    range === r
                      ? "bg-brand text-white"
                      : "border-border text-muted-foreground"
                  }
                  data-ocid={`reports.${r}.button`}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 bg-input border-border w-full sm:w-44"
              data-ocid="reports.start.input"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 bg-input border-border w-full sm:w-44"
              data-ocid="reports.end.input"
            />
          </div>
        </div>
        <Button
          className="bg-brand hover:bg-brand-dark text-white min-h-[44px]"
          onClick={handleExport}
          disabled={generating}
          data-ocid="reports.export.button"
        >
          <FileText className="w-4 h-4 mr-2" />
          {generating ? "Generating..." : "Export PDF"}
        </Button>
      </div>

      {/* Preview table */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
        <h3 className="text-foreground font-semibold mb-4">
          Preview ({workers.length} workers)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px]">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Name",
                  "Department",
                  "Phone",
                  "Present Days",
                  "Perm Hours",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workers.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="text-center py-6 text-muted-foreground text-sm"
                    data-ocid="reports.preview.empty_state"
                  >
                    No workers enrolled.
                  </td>
                </tr>
              ) : (
                workers.map((w, i) => {
                  const start = new Date(startDate).getTime();
                  const end = new Date(endDate).getTime() + 86400000;
                  const wAtt = attendance.filter(
                    (a) =>
                      a.workerId === w.id &&
                      new Date(a.date).getTime() >= start &&
                      new Date(a.date).getTime() <= end,
                  );
                  const wPerm = permissions.filter(
                    (p) => p.workerId === w.id && p.status === "approved",
                  );
                  const presentDays = wAtt.filter(
                    (a) => a.status === "present",
                  ).length;
                  const permHours = wPerm.reduce((s, p) => s + p.hours, 0);
                  return (
                    <tr
                      key={w.id}
                      className="border-b border-border/50"
                      data-ocid={`reports.preview.row.${i + 1}`}
                    >
                      <td className="px-3 py-2 text-sm text-foreground">
                        {w.name}
                      </td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">
                        {w.department}
                      </td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">
                        {w.phone}
                      </td>
                      <td className="px-3 py-2 text-sm text-foreground">
                        {presentDays}
                      </td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">
                        {permHours.toFixed(1)}h
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <WorkerReportCard
        workers={workers}
        attendance={attendance}
        range={range}
        startDate={startDate}
        endDate={endDate}
        companyName={companyName}
      />
    </div>
  );
}

function WorkerReportCard({
  workers,
  attendance,
  range,
  startDate,
  endDate,
  companyName,
}: {
  workers: WorkerRecord[];
  attendance: AttendanceRecord[];
  range: ReportRange;
  startDate: string;
  endDate: string;
  companyName?: string;
}) {
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [exporting, setExporting] = useState(false);

  const selectedWorker = workers.find((w) => w.id === selectedWorkerId) ?? null;

  const workerAttendance = selectedWorker
    ? attendance
        .filter((a) => {
          const start = new Date(startDate).getTime();
          const end = new Date(endDate).getTime() + 86400000;
          return (
            a.workerId === selectedWorker.id &&
            new Date(a.date).getTime() >= start &&
            new Date(a.date).getTime() <= end
          );
        })
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const handleExportWorker = async () => {
    if (!selectedWorker) return;
    setExporting(true);
    try {
      await generateWorkerReport(
        selectedWorker,
        workerAttendance,
        range,
        startDate,
        endDate,
        companyName,
      );
      toast.success("Worker report downloaded!");
    } catch (e) {
      toast.error("Failed to generate worker report");
      console.error(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
      <h3 className="text-foreground font-semibold mb-4">
        Worker-Specific Report
      </h3>
      <div className="mb-4">
        <Label className="text-xs text-muted-foreground mb-1 block">
          Select Worker
        </Label>
        <select
          value={selectedWorkerId}
          onChange={(e) => setSelectedWorkerId(e.target.value)}
          className="w-full sm:w-72 bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          data-ocid="reports.worker.select"
        >
          <option value="">Select a worker...</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} {w.department ? `(${w.department})` : ""}
            </option>
          ))}
        </select>
      </div>

      {selectedWorker && (
        <>
          <div className="overflow-x-auto mb-4">
            <table className="w-full min-w-[420px] text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-border">
                  {[
                    "Date",
                    "Status",
                    "Check-In",
                    "Check-Out",
                    "Hours",
                    "Delay",
                    "Early Leave",
                    "Overtime",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workerAttendance.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-center py-6 text-muted-foreground text-sm"
                      data-ocid="reports.worker.empty_state"
                    >
                      No attendance records in selected date range.
                    </td>
                  </tr>
                ) : (
                  workerAttendance.map((a, i) => (
                    <tr
                      key={a.id}
                      className="border-b border-border/50"
                      data-ocid={`reports.worker.row.${i + 1}`}
                    >
                      <td className="px-3 py-2 text-sm text-foreground">
                        {a.date}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <span
                          className={
                            a.status === "present"
                              ? "text-green-400"
                              : a.status === "permission"
                                ? "text-yellow-400"
                                : "text-red-400"
                          }
                        >
                          {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">
                        {a.checkIn
                          ? new Date(a.checkIn).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">
                        {a.checkOut
                          ? new Date(a.checkOut).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </td>
                      <td className="px-3 py-2 text-sm text-foreground">
                        {a.totalHours != null ? a.totalHours.toFixed(2) : "-"}
                      </td>
                      <td className="px-3 py-2 text-sm text-amber-400">
                        {formatMinutes(a.delay_minutes ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-sm text-orange-400">
                        {formatMinutes(a.early_leave_minutes ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-sm text-green-400">
                        {formatMinutes(a.overtime_minutes ?? 0)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Button
            className="bg-brand hover:bg-brand-dark text-white min-h-[44px]"
            onClick={handleExportWorker}
            disabled={exporting}
            data-ocid="reports.worker.export.button"
          >
            <FileText className="w-4 h-4 mr-2" />
            {exporting ? "Generating..." : "Export Worker Report"}
          </Button>
        </>
      )}
    </div>
  );
}

// ===== SETTINGS SECTION =====
function CompanyTimingCard() {
  const { selectedCompany } = useAuth();
  const { actor } = useBackend();
  const [startTime, setStartTime] = useState("09:30");
  const [endTime, setEndTime] = useState("19:30");
  const [grace, setGrace] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dbGetTiming(selectedCompany?.id).then((t) => {
      if (t) {
        setStartTime(t.startTime);
        setEndTime(t.endTime);
        setGrace(t.gracePeriodMinutes.toString());
      }
    });
  }, [selectedCompany?.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const companyId = selectedCompany?.id ?? "default";
      const gracePeriod = Number.parseInt(grace) || 0;
      const record: CompanyTimingRecord = {
        id: `timing-${companyId}`,
        startTime,
        endTime,
        gracePeriodMinutes: gracePeriod,
        updatedAt: Date.now(),
      };
      await dbPutTiming(record);
      // Also sync to backend
      if (actor) {
        try {
          await actor.setCompanyTiming(
            companyId,
            startTime,
            endTime,
            BigInt(gracePeriod),
          );
        } catch (e) {
          console.warn("[Backend] setCompanyTiming failed:", e);
          toast.warning(
            "Saved locally. Backend sync failed — will retry on next sync.",
          );
        }
      }
      toast.success("Company timing saved");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
      <h3 className="text-foreground font-semibold mb-4 flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-brand" /> Company Timing
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <Label className="text-xs text-muted-foreground">
            Work Start Time
          </Label>
          <Input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="mt-1 bg-input border-border"
            data-ocid="settings.start_time.input"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Work End Time</Label>
          <Input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="mt-1 bg-input border-border"
            data-ocid="settings.end_time.input"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            Grace Period (min)
          </Label>
          <Input
            type="number"
            min="0"
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
            className="mt-1 bg-input border-border"
            placeholder="e.g. 10"
            data-ocid="settings.grace_period.input"
          />
        </div>
      </div>
      <Button
        className="bg-brand hover:bg-brand-dark text-white min-h-[44px]"
        onClick={handleSave}
        disabled={saving}
        data-ocid="settings.save_timing.button"
      >
        {saving ? "Saving..." : "Save Timing"}
      </Button>
    </div>
  );
}

function SettingsSection({
  settings,
  onRefresh,
}: { settings: SettingsRecord | null; onRefresh: () => void }) {
  const { selectedCompany } = useAuth();
  const { actor } = useBackend();
  const [lat, setLat] = useState(settings?.latitude?.toString() ?? "0");
  const [lng, setLng] = useState(settings?.longitude?.toString() ?? "0");
  const [radius, setRadius] = useState(settings?.radius?.toString() ?? "500");
  const [wifi, setWifi] = useState(settings?.wifiSsid ?? "");

  const [oldPin, setOldPin] = useState("");
  const [newKw, setNewKw] = useState("");
  const [newPin, setNewPin] = useState("");
  const [savingLoc, setSavingLoc] = useState(false);
  const [savingCred, setSavingCred] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);

  useEffect(() => {
    if (settings) {
      setLat(settings.latitude.toString());
      setLng(settings.longitude.toString());
      setRadius(settings.radius.toString());
      setWifi(settings.wifiSsid ?? "");
    }
  }, [settings]);

  const saveLocationToBackend = async (
    latitude: number,
    longitude: number,
    radiusVal: number,
    wifiSsid: string | null,
    companyId: string,
  ) => {
    if (!actor) return;
    try {
      await actor.setCompanySettings(
        companyId,
        latitude,
        longitude,
        radiusVal,
        wifiSsid,
      );
    } catch (e) {
      console.warn("[Backend] setCompanySettings failed:", e);
      toast.warning(
        "Saved locally. Backend sync failed — will retry on next sync.",
      );
    }
  };

  const handleSetCurrentLocation = async () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser.");
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const existing = await dbGetSettings(selectedCompany?.id);
          const newLat = pos.coords.latitude.toString();
          const newLng = pos.coords.longitude.toString();
          const companyId = selectedCompany?.id ?? "";
          const radiusVal = existing?.radius ?? 500;
          const wifiSsid = existing?.wifiSsid ?? null;
          await dbPutSettings({
            id: `settings-${companyId}`,
            companyId,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            radius: radiusVal,
            wifiSsid: wifiSsid ?? undefined,
            updatedAt: Date.now(),
          });
          setLat(newLat);
          setLng(newLng);
          onRefresh();
          // Also sync to backend
          await saveLocationToBackend(
            pos.coords.latitude,
            pos.coords.longitude,
            radiusVal,
            wifiSsid,
            companyId,
          );
          toast.success(
            `Company location set to ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
          );
        } catch {
          toast.error("Failed to save location.");
        } finally {
          setGettingLocation(false);
        }
      },
      (err) => {
        setGettingLocation(false);
        if (err.code === err.PERMISSION_DENIED) {
          toast.error("Location permission denied. Please allow access.");
        } else {
          toast.error("Could not get location. Please try again.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleSaveLocation = async () => {
    setSavingLoc(true);
    try {
      const companyId = selectedCompany?.id ?? "";
      const latitude = Number.parseFloat(lat);
      const longitude = Number.parseFloat(lng);
      const radiusVal = Number.parseInt(radius);
      const wifiSsid = wifi || null;
      await dbPutSettings({
        id: `settings-${companyId}`,
        companyId,
        latitude,
        longitude,
        radius: radiusVal,
        wifiSsid: wifiSsid ?? undefined,
        updatedAt: Date.now(),
      });
      onRefresh();
      // Also sync to backend
      await saveLocationToBackend(
        latitude,
        longitude,
        radiusVal,
        wifiSsid,
        companyId,
      );
      toast.success("Location settings saved");
    } finally {
      setSavingLoc(false);
    }
  };

  const handleSaveCreds = async () => {
    if (!newKw.trim() || !newPin) {
      toast.error("Fill all fields");
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      toast.error("PIN must be 4 digits");
      return;
    }
    setSavingCred(true);
    try {
      const mgr = await dbGetManager();
      if (!mgr) {
        toast.error("No credentials found");
        return;
      }
      const oldPinHash = await hashSHA256(oldPin);
      if (oldPinHash !== mgr.pinHash) {
        toast.error("Old PIN is incorrect");
        return;
      }
      const [kwH, pinH] = await Promise.all([
        hashSHA256(newKw),
        hashSHA256(newPin),
      ]);
      await dbPutManager({
        id: "credentials",
        keywordHash: kwH,
        pinHash: pinH,
        updatedAt: Date.now(),
      });
      setOldPin("");
      setNewKw("");
      setNewPin("");
      toast.success("Credentials updated");
    } finally {
      setSavingCred(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-2xl">
      {/* Location */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
        <h3 className="text-foreground font-semibold mb-4 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-brand" /> Location Settings
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <Label className="text-xs text-muted-foreground">Latitude</Label>
            <Input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="mt-1 bg-input border-border"
              type="number"
              step="0.0001"
              data-ocid="settings.lat.input"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Longitude</Label>
            <Input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="mt-1 bg-input border-border"
              type="number"
              step="0.0001"
              data-ocid="settings.lng.input"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              Radius (meters)
            </Label>
            <Input
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              className="mt-1 bg-input border-border"
              type="number"
              data-ocid="settings.radius.input"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              WiFi SSID (optional)
            </Label>
            <Input
              value={wifi}
              onChange={(e) => setWifi(e.target.value)}
              className="mt-1 bg-input border-border"
              placeholder="Company WiFi name"
              data-ocid="settings.wifi.input"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            className="bg-brand hover:bg-brand-dark text-white min-h-[44px]"
            onClick={handleSaveLocation}
            disabled={savingLoc}
            data-ocid="settings.save_location.button"
          >
            {savingLoc ? "Saving..." : "Save Location"}
          </Button>
          <Button
            variant="outline"
            className="border-border text-muted-foreground hover:text-foreground gap-2 min-h-[44px]"
            onClick={handleSetCurrentLocation}
            disabled={gettingLocation}
            data-ocid="settings.set_current_location.button"
          >
            {gettingLocation ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MapPin className="w-4 h-4" />
            )}
            Set Current Location as Company
          </Button>
        </div>
      </div>

      {/* Company Timing */}
      <CompanyTimingCard />

      {/* Credentials */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
        <h3 className="text-foreground font-semibold mb-4 flex items-center gap-2">
          <Lock className="w-5 h-5 text-brand" /> Update Credentials
        </h3>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Current PIN</Label>
            <Input
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value)}
              type="password"
              maxLength={4}
              placeholder="••••"
              className="mt-1 bg-input border-border max-w-xs"
              data-ocid="settings.old_pin.input"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">New Keyword</Label>
            <Input
              value={newKw}
              onChange={(e) => setNewKw(e.target.value)}
              placeholder="New secret keyword"
              className="mt-1 bg-input border-border max-w-xs"
              data-ocid="settings.new_keyword.input"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">New PIN</Label>
            <Input
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.slice(0, 4))}
              type="password"
              maxLength={4}
              placeholder="••••"
              className="mt-1 bg-input border-border max-w-xs"
              data-ocid="settings.new_pin.input"
            />
          </div>
          <Button
            className="bg-brand hover:bg-brand-dark text-white min-h-[44px]"
            onClick={handleSaveCreds}
            disabled={savingCred}
            data-ocid="settings.save_credentials.button"
          >
            {savingCred ? "Saving..." : "Update Credentials"}
          </Button>
        </div>
      </div>
    </div>
  );
}
