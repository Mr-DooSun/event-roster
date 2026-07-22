export type Half = "H1" | "H2";

export type EventStatus = "DRAFT" | "PRE_REGISTRATION" | "DAY_OF" | "CLOSED";

export interface EventSummary {
  eventId: string;
  expectedTotal: number;
  finalTotal: number;
  deltaTotal: number;
  organizations: Array<{
    organizationId: string;
    organizationName: string;
    expected: number;
    dayOfAdded: number;
    dayOfCancelled: number;
    final: number;
    delta: number;
  }>;
}
