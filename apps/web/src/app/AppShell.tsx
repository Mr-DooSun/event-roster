import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { LoadingStatus } from "../components/ui/LoadingStatus";
import { OrganizationDetailPage } from "../features/admin/OrganizationDetailPage";
import { OrganizationsPage } from "../features/admin/OrganizationsPage";
import { UsersPage } from "../features/admin/UsersPage";
import { useAuth } from "../features/auth/AuthProvider";
import { ProjectDetailPage } from "../features/projects/ProjectDetailPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";

const ImportWizard = lazy(() =>
  import("../features/imports/ImportWizard").then((module) => ({
    default: module.ImportWizard,
  })),
);

export function AppShell() {
  const { auth, logout } = useAuth();
  const path = usePathname();
  const operator = auth?.session.user.role === "OPERATOR";
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <div className="er-app-shell">
      <header className="er-app-header">
        <div>
          <p className="er-eyebrow">PROJECT ROSTER</p>
          <strong>프로젝트 참가자 명단</strong>
        </div>
        <div className="er-user-actions">
          <span>{auth?.session.user.displayName}</span>
          <Button
            type="button"
            onClick={() => void handleLogout()}
            loading={loggingOut}
            loadingText="로그아웃 중…"
          >
            로그아웃
          </Button>
        </div>
      </header>
      <div className="er-app-body">
        <nav className="er-nav" aria-label="주 메뉴">
          <NavLink href="/projects">프로젝트</NavLink>
          {operator ? (
            <>
              <NavLink href="/organizations">조직 관리</NavLink>
              <NavLink href="/users">계정</NavLink>
            </>
          ) : null}
        </nav>
        <main className="er-content">{route(path, operator)}</main>
      </div>
    </div>
  );
}

function route(path: string, operator: boolean) {
  if (path === "/" || path === "/projects") return <ProjectsPage />;
  if (path === "/organizations" && operator) return <OrganizationsPage />;
  if (path === "/users" && operator) return <UsersPage />;
  const organizationMatch = path.match(/^\/organizations\/([^/]+)$/);
  if (organizationMatch?.[1] && operator) {
    const organizationId = decodeURIComponent(organizationMatch[1]);
    return (
      <OrganizationDetailPage
        key={organizationId}
        organizationId={organizationId}
      />
    );
  }
  const importMatch = path.match(/^\/projects\/([^/]+)\/import$/);
  if (importMatch?.[1] && operator) {
    return (
      <Suspense
        fallback={
          <div aria-busy="true">
            <LoadingStatus className="er-panel-loading">
              엑셀 도구 불러오는 중…
            </LoadingStatus>
          </div>
        }
      >
        <ImportWizard projectId={decodeURIComponent(importMatch[1])} />
      </Suspense>
    );
  }
  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  if (projectMatch?.[1]) {
    return (
      <ProjectDetailPage projectId={decodeURIComponent(projectMatch[1])} />
    );
  }
  return <ProjectsPage />;
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
