export interface EvidenceFileCandidate {
  name: string;
  modifiedTimeMs: number;
}

export function selectLatestEvidenceFile(
  candidates: readonly EvidenceFileCandidate[],
): EvidenceFileCandidate {
  if (candidates.length === 0) {
    throw new Error("no Workers bcrypt evidence exists");
  }
  if (
    candidates.some(
      (candidate) =>
        !Number.isFinite(candidate.modifiedTimeMs) ||
        candidate.modifiedTimeMs < 0,
    )
  ) {
    throw new Error("invalid evidence mtime");
  }

  const latestModifiedTime = Math.max(
    ...candidates.map((candidate) => candidate.modifiedTimeMs),
  );
  const newest = candidates.filter(
    (candidate) => candidate.modifiedTimeMs === latestModifiedTime,
  );
  if (newest.length !== 1) {
    throw new Error("ambiguous latest evidence");
  }
  const selected = newest[0];
  if (!selected) {
    throw new Error("ambiguous latest evidence");
  }
  return selected;
}
