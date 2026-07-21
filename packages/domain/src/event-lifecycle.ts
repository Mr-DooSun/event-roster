import type { EventStatus, Role } from "@event-roster/contracts";
import { DomainError } from "./errors";

const FORWARD_TRANSITIONS: Readonly<Record<EventStatus, EventStatus | null>> = {
  DRAFT: "PRE_REGISTRATION",
  PRE_REGISTRATION: "DAY_OF",
  DAY_OF: "CLOSED",
  CLOSED: null,
};

export function transitionEvent(
  current: EventStatus,
  target: EventStatus,
  role: Role,
): EventStatus {
  if (role !== "OPERATOR") {
    throw new DomainError("FORBIDDEN");
  }

  const isForwardTransition = FORWARD_TRANSITIONS[current] === target;
  const isApprovedReopen = current === "CLOSED" && target === "DAY_OF";

  if (!isForwardTransition && !isApprovedReopen) {
    throw new DomainError("INVALID_TRANSITION");
  }

  return target;
}
