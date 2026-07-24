import type { AuthSuccess } from "@event-roster/contracts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ApiClient,
  ApiError,
  createApiClient,
  parseResponse,
} from "../../lib/api";
import {
  anonymousState,
  authenticatedState,
  type MemoryAuthState,
} from "../../lib/auth-session";

interface AuthContextValue extends MemoryAuthState {
  api: ApiClient;
  error: string | null;
  login: (loginId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  recover: (input: {
    loginId: string;
    recoveryCode: string;
    newPassword: string;
  }) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  restoreOnMount = true,
}: {
  children: ReactNode;
  restoreOnMount?: boolean;
}) {
  const initialState: MemoryAuthState = restoreOnMount
    ? { auth: null, status: "RESTORING" }
    : anonymousState;
  const [state, setState] = useState<MemoryAuthState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const authEpochRef = useRef(0);
  const restoreStarted = useRef(false);

  const commitState = useCallback((next: MemoryAuthState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const refresh = useCallback(
    async (expectedEpoch: number): Promise<AuthSuccess | null> => {
      try {
        const response = await fetch("/api/v1/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        const auth = await parseResponse<AuthSuccess>(response);
        if (authEpochRef.current !== expectedEpoch) return null;
        commitState(authenticatedState(auth));
        return auth;
      } catch {
        if (authEpochRef.current === expectedEpoch) commitState(anonymousState);
        return null;
      }
    },
    [commitState],
  );

  const api = useMemo(
    () =>
      createApiClient({
        getAuth: () => stateRef.current.auth,
        getAuthEpoch: () => authEpochRef.current,
        refresh,
      }),
    [refresh],
  );

  useEffect(() => {
    if (!restoreOnMount || restoreStarted.current) return;
    restoreStarted.current = true;
    void api.refreshAuthentication();
  }, [api, restoreOnMount]);

  const login = useCallback(
    async (loginId: string, password: string) => {
      setError(null);
      const loginEpoch = authEpochRef.current + 1;
      authEpochRef.current = loginEpoch;
      try {
        await api.waitForRefresh();
        const response = await fetch("/api/v1/auth/login", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loginId, password }),
        });
        const auth = await parseResponse<AuthSuccess>(response);
        if (authEpochRef.current === loginEpoch) {
          commitState(authenticatedState(auth));
        }
      } catch (caught) {
        if (authEpochRef.current === loginEpoch) {
          setError(loginErrorMessage(caught));
        }
      }
    },
    [api, commitState],
  );

  const logout = useCallback(async () => {
    setError(null);
    authEpochRef.current += 1;
    stateRef.current = { auth: null, status: "RESTORING" };
    try {
      await api.waitForRefresh();
      await parseResponse<void>(
        await fetch("/api/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        }),
      );
    } catch {
      // Clearing memory is mandatory even when the network is unavailable.
    } finally {
      commitState(anonymousState);
      navigate("/login");
    }
  }, [api, commitState]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setError(null);
      const changeEpoch = authEpochRef.current + 1;
      authEpochRef.current = changeEpoch;
      try {
        await api.post<void>("/auth/change-password", {
          currentPassword,
          newPassword,
        });
        if (authEpochRef.current !== changeEpoch) return;
        commitState({ auth: null, status: "RESTORING" });
        await api.waitForRefresh();
        try {
          await parseResponse<void>(
            await fetch("/api/v1/auth/logout", {
              method: "POST",
              credentials: "include",
            }),
          );
        } catch {
          // The password change already revoked the old server-side session.
        }
        commitState(anonymousState);
        navigate("/login");
      } catch (caught) {
        if (authEpochRef.current === changeEpoch) {
          setError(genericErrorMessage(caught));
        }
      }
    },
    [api, commitState],
  );

  const recover = useCallback(
    async (input: {
      loginId: string;
      recoveryCode: string;
      newPassword: string;
    }) => {
      setError(null);
      try {
        const response = await fetch("/api/v1/auth/recover", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        await parseResponse<void>(response);
        navigate("/login");
      } catch (caught) {
        setError(genericErrorMessage(caught));
      }
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      api,
      error,
      login,
      logout,
      changePassword,
      recover,
      clearError: () => setError(null),
    }),
    [api, changePassword, error, login, logout, recover, state],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is required");
  return value;
}

function loginErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 503) {
    return "잠시 후 다시 로그인해 주세요.";
  }
  if (error instanceof ApiError && error.status === 429) {
    return "로그인 시도가 제한되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "로그인 ID 또는 비밀번호를 확인해 주세요.";
}

function genericErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.problem?.message ?? error.message;
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
