const PREFIX = "event-roster:recent-organizations:v1";
const LIMIT = 3;

export interface OrganizationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function recentOrganizationStorageKey(
  userId: string,
  projectId: string,
): string {
  return `${PREFIX}:${userId}:${projectId}`;
}

export function readRecentOrganizationIds(input: {
  storage: OrganizationStorage | null;
  userId: string;
  projectId: string;
  validOrganizationIds: ReadonlySet<string>;
}): string[] {
  if (!input.storage) {
    return [];
  }

  try {
    const stored = input.storage.getItem(
      recentOrganizationStorageKey(input.userId, input.projectId),
    );
    const parsed: unknown = stored ? JSON.parse(stored) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    const recentIds: string[] = [];
    const seenIds = new Set<string>();

    for (const id of parsed) {
      if (
        typeof id === "string" &&
        input.validOrganizationIds.has(id) &&
        !seenIds.has(id)
      ) {
        seenIds.add(id);
        recentIds.push(id);
      }
    }

    return recentIds.slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function recordRecentOrganizationId(input: {
  storage: OrganizationStorage | null;
  userId: string;
  projectId: string;
  organizationId: string;
  validOrganizationIds: ReadonlySet<string>;
}): string[] {
  const current = readRecentOrganizationIds(input);
  const next = [
    input.organizationId,
    ...current.filter((id) => id !== input.organizationId),
  ]
    .filter((id) => input.validOrganizationIds.has(id))
    .slice(0, LIMIT);

  try {
    input.storage?.setItem(
      recentOrganizationStorageKey(input.userId, input.projectId),
      JSON.stringify(next),
    );
  } catch {
    // Persistence is optional; callers still receive the updated order.
  }

  return next;
}

export function orderOrganizationsByRecent<T extends { id: string }>(
  organizations: readonly T[],
  recentOrganizationIds: readonly string[],
): T[] {
  const rankById = new Map<string, number>();

  for (const [rank, id] of recentOrganizationIds.entries()) {
    if (!rankById.has(id)) {
      rankById.set(id, rank);
    }
  }

  return organizations
    .map((organization, index) => ({ organization, index }))
    .sort((left, right) => {
      const leftRank = rankById.get(left.organization.id);
      const rightRank = rankById.get(right.organization.id);

      if (leftRank === undefined && rightRank === undefined) {
        return left.index - right.index;
      }
      if (leftRank === undefined) {
        return 1;
      }
      if (rightRank === undefined) {
        return -1;
      }
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ organization }) => organization);
}

export function getBrowserOrganizationStorage(): OrganizationStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
