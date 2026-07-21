import type { AuthSuccess } from "@event-roster/contracts";

export interface MemoryAuthState {
  auth: AuthSuccess | null;
  status: "RESTORING" | "ANONYMOUS" | "AUTHENTICATED";
}

export function authenticatedState(auth: AuthSuccess): MemoryAuthState {
  return { auth, status: "AUTHENTICATED" };
}

export const anonymousState: MemoryAuthState = {
  auth: null,
  status: "ANONYMOUS",
};
