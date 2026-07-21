import type { NormalizedImportRow } from "@event-roster/contracts";
import { DomainError } from "./errors";

function duplicateKey(row: NormalizedImportRow): string {
  return `${row.name.normalize("NFKC").toLocaleLowerCase()}\u0000${row.organizationName
    .normalize("NFKC")
    .toLocaleLowerCase()}`;
}

export function validateNormalizedRows(
  rows: NormalizedImportRow[],
): NormalizedImportRow[] {
  if (rows.length < 1 || rows.length > 130) {
    throw new DomainError("VALIDATION_FAILED", { field: "rows" });
  }

  const seen = new Set<string>();
  const normalizedRows = rows.map((row) => {
    const normalized = {
      ...row,
      name: row.name.trim(),
      organizationName: row.organizationName.trim(),
    };

    if (
      !Number.isInteger(normalized.rowNumber) ||
      normalized.rowNumber < 1 ||
      normalized.name.length === 0 ||
      normalized.organizationName.length === 0
    ) {
      throw new DomainError("VALIDATION_FAILED", {
        rowNumber: row.rowNumber,
      });
    }

    const key = duplicateKey(normalized);
    if (seen.has(key)) {
      throw new DomainError("VALIDATION_FAILED", {
        rowNumber: row.rowNumber,
        reason: "DUPLICATE_PARTICIPANT",
      });
    }
    seen.add(key);

    return normalized;
  });

  return normalizedRows;
}
