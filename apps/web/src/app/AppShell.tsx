import { useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { OrganizationsPage } from "../features/admin/OrganizationsPage";
import { UsersPage } from "../features/admin/UsersPage";
import { useAuth } from "../features/auth/AuthProvider";
import { EventsPage } from "../features/events/EventsPage";
import { RosterPage } from "../features/roster/RosterPage";

export function AppShell() {
  const { auth, logout } = useAuth();
  const path = usePathname();
  const operator = auth?.session.user.role === "OPERATOR";
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
      <div className="er-app-body">
        <nav className="er-nav" aria-label="주 메뉴">
          <NavLink href="/events">행사</NavLink>
          {operator ? <NavLink href="/organizations">조직</NavLink> : null}
          {operator ? <NavLink href="/users">계정</NavLink> : null}
        </nav>
        <main className="er-content">{route(path, operator)}</main>
      </div>
    </div>
  );
}

function route(path: string, operator: boolean) {
  if (path === "/") {
    return (
      <div>
        <h1>행사 운영 홈</h1>
        <p className="er-muted">행사와 참가 명단을 한곳에서 관리합니다.</p>
      </div>
    );
  }
  if (path === "/organizations" && operator) return <OrganizationsPage />;
  if (path === "/users" && operator) return <UsersPage />;
  const eventMatch = path.match(/^\/events\/([^/]+)$/);
  if (eventMatch?.[1])
    return <RosterPage eventId={decodeURIComponent(eventMatch[1])} />;
  return <EventsPage />;
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        window.history.pushState(null, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    >
      {children}
    </a>
  );
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
