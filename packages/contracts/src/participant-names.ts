export function normalizeParticipantName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function canonicalizeParticipantName(value: string): string {
  return normalizeParticipantName(value).toLowerCase();
}
