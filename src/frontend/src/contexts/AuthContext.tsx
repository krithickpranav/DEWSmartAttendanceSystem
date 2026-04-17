import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { getDB } from "../lib/db";
import type { WorkerRecord } from "../lib/db";
import {
  type SyncStatus,
  onSyncUpdate,
  startSync,
  stopSync,
} from "../lib/sync";

export type UserRole = "worker" | "manager" | null;

export interface Company {
  id: string;
  name: string;
}

export const COMPANIES: Company[] = [
  { id: "deepam-engineering", name: "Deepam Engineering Works" },
  { id: "deepam-traders", name: "Deepam Traders" },
];

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARN_BEFORE_MS = 60 * 1000; // warn 1 minute before

interface AuthContextValue {
  role: UserRole;
  currentWorker: WorkerRecord | null;
  managerName: string;
  selectedCompany: Company | null;
  setSelectedCompany: (company: Company | null) => void;
  login: (role: UserRole, worker?: WorkerRecord) => void;
  logout: () => void;
  isInitializing: boolean;
  idleWarning: boolean;
  dismissIdleWarning: () => void;
  syncStatus: SyncStatus;
}

const AuthContext = createContext<AuthContextValue>({
  role: null,
  currentWorker: null,
  managerName: "Manager",
  selectedCompany: null,
  setSelectedCompany: () => {},
  login: () => {},
  logout: () => {},
  isInitializing: true,
  idleWarning: false,
  dismissIdleWarning: () => {},
  syncStatus: "idle",
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<UserRole>(null);
  const [currentWorker, setCurrentWorker] = useState<WorkerRecord | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [selectedCompany, setSelectedCompanyState] = useState<Company | null>(
    null,
  );
  const [idleWarning, setIdleWarning] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopSyncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    getDB().finally(() => setIsInitializing(false));
  }, []);

  // Subscribe to sync status updates
  useEffect(() => {
    const unsub = onSyncUpdate((status) => setSyncStatus(status));
    return unsub;
  }, []);

  const doLogout = useCallback(() => {
    setRole(null);
    setCurrentWorker(null);
    setSelectedCompanyState(null);
    setIdleWarning(false);
    // Stop sync on logout
    stopSyncRef.current?.();
    stopSyncRef.current = null;
    stopSync();
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (!role) return;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    setIdleWarning(false);

    warnTimerRef.current = setTimeout(() => {
      setIdleWarning(true);
    }, IDLE_TIMEOUT_MS - WARN_BEFORE_MS);

    idleTimerRef.current = setTimeout(() => {
      doLogout();
    }, IDLE_TIMEOUT_MS);
  }, [role, doLogout]);

  // Track user activity to reset idle timer
  useEffect(() => {
    if (!role) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      setIdleWarning(false);
      return;
    }

    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    const handler = () => resetIdleTimer();

    for (const ev of events) {
      window.addEventListener(ev, handler, { passive: true });
    }
    resetIdleTimer();

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, handler);
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    };
  }, [role, resetIdleTimer]);

  const login = useCallback((r: UserRole, worker?: WorkerRecord) => {
    setRole(r);
    setCurrentWorker(worker ?? null);
  }, []);

  const logout = useCallback(() => {
    doLogout();
  }, [doLogout]);

  const dismissIdleWarning = useCallback(() => {
    setIdleWarning(false);
    resetIdleTimer();
  }, [resetIdleTimer]);

  // Start sync when a company is selected and logged in
  useEffect(() => {
    if (role && selectedCompany) {
      // Stop any previous sync
      stopSyncRef.current?.();
      const cleanup = startSync(selectedCompany.id);
      stopSyncRef.current = cleanup;
      return cleanup;
    }
    // Stop sync when logged out or no company
    if (!role || !selectedCompany) {
      stopSyncRef.current?.();
      stopSyncRef.current = null;
      stopSync();
    }
  }, [role, selectedCompany]);

  const setSelectedCompany = useCallback((company: Company | null) => {
    setSelectedCompanyState(company);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        role,
        currentWorker,
        managerName: "Manager",
        selectedCompany,
        setSelectedCompany,
        login,
        logout,
        isInitializing,
        idleWarning,
        dismissIdleWarning,
        syncStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
