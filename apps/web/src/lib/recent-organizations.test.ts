import { describe, expect, it } from "vitest";
import {
  type OrganizationStorage,
  orderOrganizationsByRecent,
  readRecentOrganizationIds,
  recordRecentOrganizationId,
} from "./recent-organizations";

function memoryStorage(): OrganizationStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("recent organizations", () => {
  it("scopes recent IDs by user and project and keeps newest three", () => {
    const storage = memoryStorage();
    const validOrganizationIds = new Set(["a", "b", "c", "d"]);

    for (const organizationId of ["a", "b", "c", "a", "d"]) {
      recordRecentOrganizationId({
        storage,
        userId: "user-1",
        projectId: "project-1",
        organizationId,
        validOrganizationIds,
      });
    }

    expect(
      readRecentOrganizationIds({
        storage,
        userId: "user-1",
        projectId: "project-1",
        validOrganizationIds,
      }),
    ).toEqual(["d", "a", "c"]);
    expect(
      readRecentOrganizationIds({
        storage,
        userId: "user-2",
        projectId: "project-1",
        validOrganizationIds,
      }),
    ).toEqual([]);
  });

  it("ignores corrupt data, inactive IDs, and storage failures", () => {
    const throwingStorage: OrganizationStorage = {
      getItem() {
        throw new DOMException("denied");
      },
      setItem() {
        throw new DOMException("denied");
      },
    };
    const corruptStorage: OrganizationStorage = {
      getItem: () => "[not-json]",
      setItem: () => undefined,
    };
    const inactiveStorage: OrganizationStorage = {
      getItem: () => '["inactive", "active", "active", 1]',
      setItem: () => undefined,
    };

    expect(
      readRecentOrganizationIds({
        storage: corruptStorage,
        userId: "user-1",
        projectId: "project-1",
        validOrganizationIds: new Set(["active"]),
      }),
    ).toEqual([]);
    expect(
      readRecentOrganizationIds({
        storage: inactiveStorage,
        userId: "user-1",
        projectId: "project-1",
        validOrganizationIds: new Set(["active"]),
      }),
    ).toEqual(["active"]);
    expect(
      readRecentOrganizationIds({
        storage: throwingStorage,
        userId: "user-1",
        projectId: "project-1",
        validOrganizationIds: new Set(["active"]),
      }),
    ).toEqual([]);
    expect(
      recordRecentOrganizationId({
        storage: throwingStorage,
        userId: "user-1",
        projectId: "project-1",
        organizationId: "active",
        validOrganizationIds: new Set(["active"]),
      }),
    ).toEqual(["active"]);
  });

  it("moves recent organizations first without reordering the rest", () => {
    const organizations = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
      { id: "d", name: "D" },
    ];

    expect(orderOrganizationsByRecent(organizations, ["c", "a"])).toEqual([
      organizations[2],
      organizations[0],
      organizations[1],
      organizations[3],
    ]);
  });
});
