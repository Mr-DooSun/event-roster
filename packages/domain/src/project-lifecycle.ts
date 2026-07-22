import type { ProjectStatus, Role } from "@event-roster/contracts";
import { DomainError } from "./errors";

const FORWARD: Readonly<Record<ProjectStatus, ProjectStatus | null>> = {
  PREPARING: "PRE_REGISTRATION",
  PRE_REGISTRATION: "IN_PROGRESS",
  IN_PROGRESS: "CLOSED",
  CLOSED: null,
};

export function transitionProject(
  current: ProjectStatus,
  target: ProjectStatus,
  role: Role,
): ProjectStatus {
  if (role !== "OPERATOR") throw new DomainError("FORBIDDEN");
  if (
    FORWARD[current] === target ||
    (current === "CLOSED" && target === "IN_PROGRESS")
  ) {
    return target;
  }
  throw new DomainError("INVALID_TRANSITION");
}
