import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  Building2,
  CheckCircle,
  ChevronRight,
  Eye,
  Loader2,
  Lock,
  MapPin,
  RefreshCw,
  ScanFace,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { COMPANIES, useAuth } from "../contexts/AuthContext";
import { useBackend } from "../hooks/useBackend";
import { hashSHA256 } from "../lib/crypto";
import {
  dbGetAllWorkersByCompany,
  dbGetManager,
  dbGetSettings,
  dbPutManager,
} from "../lib/db";
import {
  type FaceDetectionFrame,
  checkLiveness,
  detectFaceBox,
  extractEmbedding,
  loadFaceModels,
  matchFace,
} from "../lib/faceRecognition";
import { checkGeoAccess } from "../lib/geoRestriction";

const COMPANY_LOGOS: Record<string, string> = {
  "deepam-engineering":
    "/assets/generated/deepam-engineering-logo-transparent.dim_400x400.png",
  "deepam-traders":
    "/assets/generated/deepam-traders-logo-transparent.dim_400x400.png",
};

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const LOCKOUT_KEY = "manager_login_lockout";

function getLockoutState(): { attempts: number; lockedUntil: number } {
  try {
    const raw = sessionStorage.getItem(LOCKOUT_KEY);
    if (!raw) return { attempts: 0, lockedUntil: 0 };
    return JSON.parse(raw) as { attempts: number; lockedUntil: number };
  } catch {
    return { attempts: 0, lockedUntil: 0 };
  }
}

function saveLockoutState(state: { attempts: number; lockedUntil: number }) {
  sessionStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
}

type ScanStatus =
  | "idle"
  | "geo-checking"
  | "geo-verified"
  | "loading-models"
  | "scanning"
  | "verifying"
  | "success"
  | "fail"
  | "geo-fail"
  | "no-face";

export default function LoginPage() {
  const {
    login,
    selectedCompany,
    setSelectedCompany,
    idleWarning,
    dismissIdleWarning,
    logout,
  } = useAuth();
  const { actor } = useBackend();
  const [activeTab, setActiveTab] = useState("worker");

  // Worker face login
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const framesRef = useRef<FaceDetectionFrame[]>([]);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [statusMsg, setStatusMsg] = useState('Tap "Start Face Scan" to begin.');
  const [faceDetected, setFaceDetected] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  // Manager login
  const [keyword, setKeyword] = useState("");
  const [pin, setPin] = useState("");
  const [isSetup, setIsSetup] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [managerLoading, setManagerLoading] = useState(false);

  // Rate limiting
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [lockoutCountdown, setLockoutCountdown] = useState(0);

  // Sync rate-limit state from sessionStorage on mount
  useEffect(() => {
    const state = getLockoutState();
    setLoginAttempts(state.attempts);
    setLockedUntil(state.lockedUntil);
  }, []);

  // Countdown timer for lockout
  useEffect(() => {
    if (lockedUntil <= Date.now()) {
      setLockoutCountdown(0);
      return;
    }
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockoutCountdown(0);
        setLockedUntil(0);
        setLoginAttempts(0);
        saveLockoutState({ attempts: 0, lockedUntil: 0 });
      } else {
        setLockoutCountdown(remaining);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) {
        t.stop();
      }
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const runFaceLoop = useCallback(async () => {
    if (!videoRef.current || !cameraReady) return;
    const video = videoRef.current;
    if (video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runFaceLoop);
      return;
    }

    const box = await detectFaceBox(video);
    if (box) {
      setFaceDetected(true);
      framesRef.current = [...framesRef.current.slice(-30), box];
      const isLive = checkLiveness(framesRef.current);

      if (isLive) {
        setScanStatus("verifying");
        setStatusMsg("Verifying identity...");
        const embedding = await extractEmbedding(video);
        if (embedding) {
          const workers = await dbGetAllWorkersByCompany(
            selectedCompany?.id ?? "",
          );
          const match = matchFace(embedding, workers);
          if (match) {
            setScanStatus("success");
            setStatusMsg(`Welcome, ${match.worker.name}!`);
            stopCamera();
            setTimeout(() => login("worker", match.worker), 800);
            return;
          }
          setScanStatus("fail");
          setStatusMsg("Face not recognized. Please contact manager.");
          setTimeout(() => {
            setScanStatus("scanning");
            setStatusMsg("Move your face to verify liveness...");
            framesRef.current = [];
          }, 3000);
        }
      } else {
        setScanStatus("scanning");
        setStatusMsg("Move your face slightly to verify liveness...");
      }
    } else {
      setFaceDetected(false);
      setScanStatus("scanning");
      setStatusMsg("Position your face in the camera...");
    }

    rafRef.current = requestAnimationFrame(runFaceLoop);
  }, [cameraReady, stopCamera, login, selectedCompany?.id]);

  useEffect(() => {
    if (cameraReady && scanStatus === "scanning") {
      rafRef.current = requestAnimationFrame(runFaceLoop);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [cameraReady, scanStatus, runFaceLoop]);

  const startWorkerLogin = useCallback(async () => {
    setScanStatus("geo-checking");
    setStatusMsg("Checking your location...");
    framesRef.current = [];

    const settings = await dbGetSettings(selectedCompany?.id);

    if (!settings) {
      setScanStatus("geo-fail");
      setStatusMsg(
        "Company location not configured. Please ask the manager to set company location in Settings.",
      );
      return;
    }

    const geoResult = await checkGeoAccess(
      settings.latitude,
      settings.longitude,
      settings.radius,
    );
    if (!geoResult.allowed) {
      setScanStatus("geo-fail");
      setStatusMsg(
        geoResult.error ??
          `You are ${geoResult.distance}m away from the company location.`,
      );
      return;
    }

    setScanStatus("geo-verified");
    setStatusMsg("Location verified! Loading face recognition...");
    await new Promise((r) => setTimeout(r, 900));

    setScanStatus("loading-models");
    setStatusMsg("Loading face recognition models...");
    const loaded = await loadFaceModels();
    if (!loaded) {
      setScanStatus("fail");
      setStatusMsg(
        "Could not load face recognition models. Check internet connection.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraReady(true);
          setScanStatus("scanning");
          setStatusMsg("Position your face in the camera...");
        };
      }
    } catch {
      setScanStatus("fail");
      setStatusMsg("Camera access denied. Please allow camera permission.");
    }
  }, [selectedCompany?.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional tab-change trigger
  useEffect(() => {
    if (activeTab === "worker") {
      setScanStatus("idle");
      setStatusMsg('Tap "Start Face Scan" to begin.');
    } else {
      stopCamera();
      setScanStatus("idle");
    }
    return () => stopCamera();
  }, [activeTab]);

  useEffect(() => {
    dbGetManager().then((m) => {
      if (!m) setIsSetup(true);
    });
  }, []);

  const handleManagerLogin = async () => {
    // Check lockout
    const now = Date.now();
    if (lockedUntil > now) {
      toast.error(`Too many attempts. Try again in ${lockoutCountdown}s.`);
      return;
    }

    setManagerLoading(true);
    try {
      let mgr = await dbGetManager();
      // If not in IDB, try to fetch from backend (mobile APK first launch)
      if (!mgr && actor && selectedCompany) {
        try {
          const backendCreds = await actor.getManagerCredentials(
            selectedCompany.id,
          );
          if (backendCreds) {
            await dbPutManager({
              id: "credentials",
              keywordHash: backendCreds.keywordHash,
              pinHash: backendCreds.pinHash,
              updatedAt: Number(backendCreds.updatedAt),
            });
            mgr = await dbGetManager();
          }
        } catch (e) {
          console.warn("[Backend] getManagerCredentials failed:", e);
        }
      }
      if (!mgr) {
        toast.error("No credentials found");
        return;
      }
      const [kwH, pinH] = await Promise.all([
        hashSHA256(keyword),
        hashSHA256(pin),
      ]);
      if (kwH === mgr.keywordHash && pinH === mgr.pinHash) {
        // Success: reset attempts
        const newState = { attempts: 0, lockedUntil: 0 };
        saveLockoutState(newState);
        setLoginAttempts(0);
        setLockedUntil(0);
        login("manager");
      } else {
        const newAttempts = loginAttempts + 1;
        if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
          const lockUntil = Date.now() + LOCKOUT_DURATION_MS;
          const newState = { attempts: newAttempts, lockedUntil: lockUntil };
          saveLockoutState(newState);
          setLoginAttempts(newAttempts);
          setLockedUntil(lockUntil);
          toast.error("Too many failed attempts. Locked for 5 minutes.");
        } else {
          const newState = { attempts: newAttempts, lockedUntil: 0 };
          saveLockoutState(newState);
          setLoginAttempts(newAttempts);
          toast.error(
            `Invalid keyword or PIN. ${MAX_LOGIN_ATTEMPTS - newAttempts} attempt${MAX_LOGIN_ATTEMPTS - newAttempts !== 1 ? "s" : ""} remaining.`,
          );
        }
      }
    } finally {
      setManagerLoading(false);
    }
  };

  const scanRingColor = {
    idle: "border-border",
    "geo-checking": "border-amber-500",
    "geo-verified": "border-green-400",
    "loading-models": "border-amber-500",
    scanning: faceDetected ? "border-brand" : "border-border",
    verifying: "border-brand",
    success: "border-green-400",
    fail: "border-red-500",
    "geo-fail": "border-red-500",
    "no-face": "border-border",
  }[scanStatus];

  const isScanning = ["scanning", "verifying"].includes(scanStatus);
  const isLocked = lockedUntil > Date.now() && lockoutCountdown > 0;

  // ── Company Selection Screen ──────────────────────────────────────────────
  if (!selectedCompany) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4 py-8"
        style={{
          background: "linear-gradient(135deg, #0B1220 0%, #101A2A 100%)",
        }}
      >
        <div className="w-full max-w-sm">
          {/* Idle warning overlay */}
          {idleWarning && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
              <div className="bg-card border border-amber-500/50 rounded-xl p-6 max-w-sm w-full text-center shadow-2xl">
                <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                <h3 className="text-foreground font-semibold text-lg mb-2">
                  Session Expiring
                </h3>
                <p className="text-muted-foreground text-sm mb-4">
                  You will be logged out in 1 minute due to inactivity.
                </p>
                <div className="flex gap-2 justify-center">
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

          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-brand/20 border border-brand/40 flex items-center justify-center">
                <ScanFace className="w-6 h-6 text-brand" />
              </div>
              <span className="text-lg font-bold text-foreground tracking-wider">
                FACEID ATTENDANCE
              </span>
            </div>
            <p className="text-muted-foreground text-sm">
              Smart Attendance Management System
            </p>
          </div>

          {/* Company Selection Card */}
          <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
            <div className="p-5">
              <div className="text-center mb-5">
                <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center mx-auto mb-3">
                  <Building2 className="w-6 h-6 text-brand" />
                </div>
                <h2 className="text-foreground font-semibold text-lg">
                  Select Company
                </h2>
                <p className="text-muted-foreground text-xs mt-1">
                  Choose your company to continue
                </p>
              </div>

              <div className="space-y-3">
                {COMPANIES.map((company) => (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => setSelectedCompany(company)}
                    className="w-full flex items-center justify-between p-4 rounded-lg border border-border bg-background hover:border-brand/50 hover:bg-brand/5 transition-all duration-200 group min-h-[56px]"
                    data-ocid={`company.select.${company.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-md overflow-hidden flex items-center justify-center flex-shrink-0">
                        <img
                          src={COMPANY_LOGOS[company.id]}
                          alt={`${company.name} logo`}
                          className="w-9 h-9 object-contain"
                        />
                      </div>
                      <span className="text-foreground font-medium text-sm text-left truncate">
                        {company.name}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-brand transition-colors flex-shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            &copy; {new Date().getFullYear()}.{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              className="hover:text-brand transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Built with ❤ using caffeine.ai
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ── Login Screen ─────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{
        background: "linear-gradient(135deg, #0B1220 0%, #101A2A 100%)",
      }}
    >
      {/* Idle warning modal */}
      {idleWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-card border border-amber-500/50 rounded-xl p-6 max-w-sm w-full text-center shadow-2xl">
            <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
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

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-brand/20 border border-brand/40 flex items-center justify-center">
              <ScanFace className="w-6 h-6 text-brand" />
            </div>
            <span className="text-lg font-bold text-foreground tracking-wider">
              FACEID ATTENDANCE
            </span>
          </div>
          {/* Company badge */}
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setSelectedCompany(null);
            }}
            className="inline-flex items-center gap-2 mt-1 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/30 hover:bg-brand/20 transition-colors max-w-full"
            data-ocid="login.change_company.button"
          >
            <img
              src={COMPANY_LOGOS[selectedCompany.id]}
              alt={`${selectedCompany.name} logo`}
              className="w-5 h-5 object-contain flex-shrink-0"
            />
            <span className="text-brand text-xs font-medium truncate max-w-[140px]">
              {selectedCompany.name}
            </span>
            <span className="text-muted-foreground text-xs flex-shrink-0">
              &#8250; Change
            </span>
          </button>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full rounded-none border-b border-border bg-card h-12">
              <TabsTrigger
                value="worker"
                className="flex-1 data-[state=active]:bg-brand/10 data-[state=active]:text-brand"
                data-ocid="login.worker.tab"
              >
                <ScanFace className="w-4 h-4 mr-1.5" /> Worker
              </TabsTrigger>
              <TabsTrigger
                value="manager"
                className="flex-1 data-[state=active]:bg-brand/10 data-[state=active]:text-brand"
                data-ocid="login.manager.tab"
              >
                <Lock className="w-4 h-4 mr-1.5" /> Manager
              </TabsTrigger>
            </TabsList>

            {/* Worker Tab */}
            <TabsContent value="worker" className="p-4 sm:p-6 mt-0">
              {/* Responsive video container: max 80vw or 260px, centered */}
              <div
                className="relative mx-auto mb-5"
                style={{
                  width: "min(80vw, 260px)",
                  height: "min(80vw, 260px)",
                }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover rounded-full"
                  style={{ transform: "scaleX(-1)" }}
                />
                <div
                  className={`absolute inset-0 rounded-full border-4 ${scanRingColor} transition-colors duration-500 ${isScanning ? "scan-ring" : ""}`}
                  style={
                    isScanning && faceDetected
                      ? { boxShadow: "0 0 24px rgba(34,197,139,0.5)" }
                      : {}
                  }
                />
                <div className="corner-bracket absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-brand rounded-tl" />
                <div className="corner-bracket absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-brand rounded-tr" />
                <div className="corner-bracket absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-brand rounded-bl" />
                <div className="corner-bracket absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-brand rounded-br" />
                {isScanning && (
                  <div className="scan-line absolute left-4 right-4 h-0.5 bg-brand/60 rounded" />
                )}
                {!cameraReady &&
                  scanStatus !== "geo-fail" &&
                  scanStatus !== "fail" && (
                    <div className="absolute inset-0 rounded-full bg-card/80 flex items-center justify-center">
                      {["geo-checking", "loading-models"].includes(
                        scanStatus,
                      ) ? (
                        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                      ) : scanStatus === "geo-verified" ? (
                        <CheckCircle className="w-10 h-10 text-green-400" />
                      ) : (
                        <ScanFace className="w-10 h-10 text-muted-foreground" />
                      )}
                    </div>
                  )}
                {scanStatus === "success" && (
                  <div className="absolute inset-0 rounded-full bg-green-500/20 flex items-center justify-center">
                    <ShieldCheck className="w-10 h-10 text-green-400" />
                  </div>
                )}
                {scanStatus === "geo-fail" && !cameraReady && (
                  <div className="absolute inset-0 rounded-full bg-red-500/10 flex items-center justify-center">
                    <MapPin className="w-10 h-10 text-red-400" />
                  </div>
                )}
              </div>

              <div className="text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  {scanStatus === "scanning" && (
                    <div className="blink-dot w-2 h-2 rounded-full bg-brand" />
                  )}
                  {scanStatus === "verifying" && (
                    <Loader2 className="w-4 h-4 text-brand animate-spin" />
                  )}
                  {scanStatus === "success" && (
                    <ShieldCheck className="w-4 h-4 text-green-400" />
                  )}
                  {scanStatus === "geo-verified" && (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  )}
                  {["fail", "geo-fail"].includes(scanStatus) && (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  )}
                  {["geo-checking", "loading-models"].includes(scanStatus) && (
                    <MapPin className="w-4 h-4 text-amber-400" />
                  )}
                  <p
                    className={`text-sm font-medium ${
                      scanStatus === "success" || scanStatus === "geo-verified"
                        ? "text-green-400"
                        : ["fail", "geo-fail"].includes(scanStatus)
                          ? "text-red-400"
                          : scanStatus === "scanning"
                            ? "text-brand"
                            : "text-muted-foreground"
                    }`}
                    data-ocid="login.scan.status"
                  >
                    {statusMsg}
                  </p>
                </div>

                {scanStatus === "geo-fail" && (
                  <p className="text-xs text-muted-foreground px-2">
                    📷 Camera will activate once you are within company range
                  </p>
                )}

                {(scanStatus === "idle" || scanStatus === "geo-fail") && (
                  <div className="flex flex-col gap-2 items-center">
                    <Button
                      size="sm"
                      className="bg-brand hover:bg-brand-dark text-white gap-2 min-h-[44px] px-5"
                      onClick={startWorkerLogin}
                      data-ocid="login.start_scan.button"
                    >
                      {scanStatus === "geo-fail" ? (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          Update Location
                        </>
                      ) : (
                        <>
                          <MapPin className="w-4 h-4" />
                          Start Face Scan
                        </>
                      )}
                    </Button>
                    {scanStatus === "geo-fail" && (
                      <p className="text-xs text-muted-foreground">
                        Move closer to your workplace and try again
                      </p>
                    )}
                  </div>
                )}

                {scanStatus === "fail" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={startWorkerLogin}
                    className="border-border text-muted-foreground hover:text-foreground min-h-[44px]"
                    data-ocid="login.retry.button"
                  >
                    Try Again
                  </Button>
                )}
              </div>

              <p className="text-center text-xs text-muted-foreground mt-4 flex items-center justify-center gap-1">
                <Eye className="w-3 h-3" /> Liveness detection active
              </p>
            </TabsContent>

            {/* Manager Tab */}
            <TabsContent value="manager" className="p-4 sm:p-6 mt-0">
              {isSetup ? (
                <div className="space-y-4" data-ocid="manager.setup.panel">
                  <div className="text-center mb-4">
                    <Lock className="w-8 h-8 text-brand mx-auto mb-2" />
                    <h3 className="text-foreground font-semibold">
                      Setup Manager Credentials
                    </h3>
                    <p className="text-muted-foreground text-xs mt-1">
                      First-time setup required
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      Secret Keyword
                    </Label>
                    <Input
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      placeholder="Enter a secret keyword"
                      className="mt-1 bg-input border-border"
                      data-ocid="manager.setup.keyword.input"
                    />
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      4-Digit PIN
                    </Label>
                    <Input
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.slice(0, 4))}
                      placeholder="••••"
                      type="password"
                      maxLength={4}
                      className="mt-1 bg-input border-border"
                      data-ocid="manager.setup.pin.input"
                    />
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      Confirm PIN
                    </Label>
                    <Input
                      value={confirmPin}
                      onChange={(e) =>
                        setConfirmPin(e.target.value.slice(0, 4))
                      }
                      placeholder="••••"
                      type="password"
                      maxLength={4}
                      className="mt-1 bg-input border-border"
                      data-ocid="manager.setup.confirm.input"
                    />
                  </div>
                  <Button
                    className="w-full bg-brand hover:bg-brand-dark text-white min-h-[44px]"
                    onClick={handleManagerSetup}
                    data-ocid="manager.setup.submit_button"
                  >
                    Save Credentials
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-center mb-4">
                    <Lock className="w-8 h-8 text-brand mx-auto mb-2" />
                    <h3 className="text-foreground font-semibold">
                      Manager Login
                    </h3>
                    <p className="text-muted-foreground text-xs mt-1">
                      Default: keyword=admin, PIN=1234
                    </p>
                  </div>

                  {/* Lockout warning */}
                  {isLocked && (
                    <div
                      className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2"
                      data-ocid="manager.login.error_state"
                    >
                      <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                      <p className="text-red-400 text-xs">
                        Too many failed attempts. Locked for{" "}
                        <span className="font-bold font-mono">
                          {lockoutCountdown}s
                        </span>
                      </p>
                    </div>
                  )}

                  <div>
                    <Label className="text-muted-foreground text-xs">
                      Secret Keyword
                    </Label>
                    <Input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Enter keyword"
                      className="mt-1 bg-input border-border"
                      data-ocid="manager.keyword.input"
                      disabled={isLocked}
                      onKeyDown={(e) =>
                        e.key === "Enter" && !isLocked && handleManagerLogin()
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      4-Digit PIN
                    </Label>
                    <Input
                      value={pin}
                      onChange={(e) => setPin(e.target.value.slice(0, 4))}
                      placeholder="••••"
                      type="password"
                      maxLength={4}
                      className="mt-1 bg-input border-border"
                      data-ocid="manager.pin.input"
                      disabled={isLocked}
                      onKeyDown={(e) =>
                        e.key === "Enter" && !isLocked && handleManagerLogin()
                      }
                    />
                  </div>
                  <Button
                    className="w-full bg-brand hover:bg-brand-dark text-white min-h-[44px]"
                    onClick={handleManagerLogin}
                    disabled={managerLoading || isLocked}
                    data-ocid="manager.login.submit_button"
                  >
                    {managerLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : null}
                    {isLocked ? `Locked (${lockoutCountdown}s)` : "Login"}
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          &copy; {new Date().getFullYear()}.{" "}
          <a
            href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
            className="hover:text-brand transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            Built with ❤ using caffeine.ai
          </a>
        </p>
      </div>
    </div>
  );

  async function handleManagerSetup() {
    if (newPin !== confirmPin) {
      toast.error("PINs do not match");
      return;
    }
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      toast.error("PIN must be 4 digits");
      return;
    }
    if (!newKeyword.trim()) {
      toast.error("Keyword is required");
      return;
    }
    const [kwH, pinH] = await Promise.all([
      hashSHA256(newKeyword),
      hashSHA256(newPin),
    ]);
    await dbPutManager({
      id: "credentials",
      keywordHash: kwH,
      pinHash: pinH,
      updatedAt: Date.now(),
    });
    setIsSetup(false);
    toast.success("Manager credentials saved! You can now log in.");
  }
}
