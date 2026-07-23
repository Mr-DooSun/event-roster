import { DomainError } from "@event-roster/domain";
import { encodeBase64Url } from "../auth/refresh-token";

const SENSITIVE_KEY = /password|hash|token|csrf|recovery|ip/i;

export function decodeCursor(cursor: string): {
  occurredAt: string;
  id: string;
} {
  try {
    const normalized = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const value = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)),
      ),
    ) as { occurredAt?: unknown; id?: unknown };
    if (typeof value.occurredAt !== "string" || typeof value.id !== "string") {
      throw new Error("invalid cursor");
    }
    return { occurredAt: value.occurredAt, id: value.id };
  } catch {
    throw new DomainError("VALIDATION_FAILED");
  }
}

export function encodeCursor(value: {
  occurredAt: string;
  id: string;
}): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

export function sanitizeAuditDetails(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return {};
    const details: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (SENSITIVE_KEY.test(key)) continue;
      const sanitized = sanitizeValue(value);
      if (sanitized === undefined) continue;
      details[key] =
        typeof sanitized === "string"
          ? sanitized
          : sanitized === null || typeof sanitized !== "object"
            ? String(sanitized)
            : JSON.stringify(sanitized);
    }
    return details;
  } catch {
    return {};
  }
}

function sanitizeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map(sanitizeValue)
      .filter(
        (item): item is Exclude<unknown, undefined> => item !== undefined,
      );
  }
  if (!isPlainObject(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) => {
      if (SENSITIVE_KEY.test(key)) return [];
      const sanitized = sanitizeValue(nested);
      return sanitized === undefined ? [] : [[key, sanitized]];
    }),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
