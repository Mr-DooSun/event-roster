import { Button } from "../components/ui/Button";
import { useAuth } from "../features/auth/AuthProvider";

export function AppShell() {
  const { auth, logout } = useAuth();
  return (
    <div className="er-app-shell">
      <header className="er-app-header">
        <div>
          <p className="er-eyebrow">EVENT ROSTER</p>
          <strong>행사 참가자 명단</strong>
        </div>
        <div className="er-user-actions">
          <span>{auth?.session.user.displayName}</span>
          <Button type="button" onClick={() => void logout()}>
            로그아웃
          </Button>
        </div>
      </header>
      <main className="er-content">
        <h1>행사 운영 홈</h1>
        <p className="er-muted">행사와 참가 명단을 한곳에서 관리합니다.</p>
      </main>
    </div>
  );
}
