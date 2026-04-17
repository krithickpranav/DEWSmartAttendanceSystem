import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LoginPage from "./pages/LoginPage";
import ManagerDashboard from "./pages/ManagerDashboard";
import WorkerDashboard from "./pages/WorkerDashboard";

function AppContent() {
  const { role, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 mx-auto rounded-full border-2 border-brand border-t-transparent animate-spin" />
          <p className="text-muted-foreground text-sm">
            Initializing system...
          </p>
        </div>
      </div>
    );
  }

  if (role === "worker") return <WorkerDashboard />;
  if (role === "manager") return <ManagerDashboard />;
  return <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
