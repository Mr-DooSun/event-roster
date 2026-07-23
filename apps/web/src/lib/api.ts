import type { ApiProblem, AuthSuccess } from "@event-roster/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ApiProblem | null,
  ) {
    super(problem?.message ?? `HTTP ${status}`);
    this.name = "ApiError";
  }
}

interface ApiClientOptions {
  getAuth: () => AuthSuccess | null;
  refresh: (expectedEpoch: number) => Promise<AuthSuccess | null>;
  getAuthEpoch?: () => number;
}

export interface ApiRequestOptions extends RequestInit {
  retryAuthentication?: boolean;
}

export function createApiClient(options: ApiClientOptions) {
  const refreshes = new Map<number, Promise<AuthSuccess | null>>();
  const getAuthEpoch = options.getAuthEpoch ?? (() => 0);

  async function refreshOnce(expectedEpoch: number) {
    let refreshInFlight = refreshes.get(expectedEpoch);
    if (!refreshInFlight) {
      const promise = options.refresh(expectedEpoch).finally(() => {
        if (refreshes.get(expectedEpoch) === promise) {
          refreshes.delete(expectedEpoch);
        }
      });
      refreshes.set(expectedEpoch, promise);
      refreshInFlight = promise;
    }
    return refreshInFlight;
  }

  async function request<T>(
    path: string,
    init: ApiRequestOptions = {},
  ): Promise<T> {
    const epochAtSend = getAuthEpoch();
    const accessTokenAtSend = options.getAuth()?.accessToken ?? null;
    const response = await send(path, init);
    if (response.status === 401 && init.retryAuthentication !== false) {
      if (getAuthEpoch() !== epochAtSend) return parseResponse<T>(response);
      const currentAuth = options.getAuth();
      if (currentAuth && currentAuth.accessToken !== accessTokenAtSend) {
        return parseResponse<T>(await send(path, init));
      }
      const refreshed = await refreshOnce(epochAtSend);
      if (refreshed && getAuthEpoch() === epochAtSend) {
        return parseResponse<T>(await send(path, init));
      }
    }
    return parseResponse<T>(response);
  }

  async function send(path: string, init: ApiRequestOptions) {
    const headers = new Headers(init.headers);
    const auth = options.getAuth();
    if (auth) headers.set("Authorization", `Bearer ${auth.accessToken}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (auth && isMutation(init.method)) {
      headers.set("X-ER-CSRF", auth.csrfToken);
    }
    return fetch(apiPath(path), {
      ...init,
      headers,
      credentials: "include",
    });
  }

  return {
    request,
    refreshAuthentication: () => refreshOnce(getAuthEpoch()),
    waitForRefresh: async () => {
      while (refreshes.size > 0) {
        await Promise.allSettled([...refreshes.values()]);
      }
    },
    get: <T>(path: string, init: Omit<ApiRequestOptions, "method"> = {}) =>
      request<T>(path, { ...init, method: "GET" }),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    patch: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let problem: ApiProblem | null = null;
    try {
      problem = (await response.json()) as ApiProblem;
    } catch {
      // Non-JSON upstream errors are intentionally reduced to status only.
    }
    throw new ApiError(response.status, problem);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function apiPath(path: string) {
  return path.startsWith("/api/") ? path : `/api/v1${path}`;
}

function isMutation(method = "GET") {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}
