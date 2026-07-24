import { useEffect, useState } from "react";
import { LoadingStatus } from "../components/ui/LoadingStatus";
import { useAuth } from "../features/auth/AuthProvider";
import { BootstrapHandoffPage } from "../features/auth/BootstrapHandoffPage";
import { ChangePasswordPage } from "../features/auth/ChangePasswordPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RecoveryPage } from "../features/auth/RecoveryPage";
import { AppShell } from "./AppShell";

export function AuthBoundary() {
  const { auth, status } = useAuth();
  const path = usePathname();
  if (status === "RESTORING") {
    return (
      <main className="er-loading" aria-busy="true">
        <LoadingStatus>로그인 상태 확인 중…</LoadingStatus>
      </main>
    );
  }
  if (!auth) return path === "/recover" ? <RecoveryPage /> : <LoginPage />;
  if (auth.session.sessionKind === "MUST_CHANGE_PASSWORD") {
    return <ChangePasswordPage />;
  }
  if (auth.session.user.isBootstrap) return <BootstrapHandoffPage />;
  return <AppShell />;
}

function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return path;
}
