import { describe, expect, it } from "vitest";

import { DomainError } from "../src/errors/DomainError";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseListInvitationsQuery,
} from "../src/validation/listInvitationsQuery";

describe("parseListInvitationsQuery", () => {
  it("accepts an empty query", () => {
    expect(parseListInvitationsQuery({})).toEqual({});
  });

  it("trims search", () => {
    expect(parseListInvitationsQuery({ search: "  Julia  " })).toEqual({
      search: "Julia",
    });
  });

  it("treats an empty trimmed search as absent", () => {
    expect(parseListInvitationsQuery({ search: "   " })).toEqual({});
  });

  it("keeps the current pagination defaults", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(15);
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(parseListInvitationsQuery({ page: "2" })).toEqual({ page: 2 });
  });

  it.each(["0", "-1", "1.5", "x"])("rejects invalid page=%s", (page) => {
    expect(() => parseListInvitationsQuery({ page })).toThrow(DomainError);
  });

  it.each(["10", "15", "25", "100"])("accepts pageSize=%s within the supported range", (pageSize) => {
    expect(parseListInvitationsQuery({ pageSize })).toEqual({ pageSize: Number(pageSize) });
  });

  it.each(["0", "-1", "101", "1.5", "x", "", "1e2"])("rejects invalid pageSize=%s", (pageSize) => {
    expect(() => parseListInvitationsQuery({ pageSize })).toThrow(DomainError);
  });

  it.each(["pending", "confirmed", "partial", "declined"])(
    "accepts rsvpStatus %s",
    (rsvpStatus) => {
      expect(parseListInvitationsQuery({ rsvpStatus })).toEqual({ rsvpStatus });
    },
  );

  it("rejects an invalid rsvpStatus", () => {
    expect(() => parseListInvitationsQuery({ rsvpStatus: "banana" })).toThrow(
      DomainError,
    );
  });

  it.each([
    ["true", true],
    ["false", false],
  ] as const)("maps archived=%s", (archived, expected) => {
    expect(parseListInvitationsQuery({ archived })).toEqual({ archived: expected });
  });

  it.each(["1", "0", "yes", "no", "TRUE"])(
    "rejects archived=%s",
    (archived) => {
      expect(() => parseListInvitationsQuery({ archived })).toThrow(DomainError);
    },
  );

  it.each([
    { search: ["Julia", "Jordi"] },
    { rsvpStatus: ["pending", "confirmed"] },
    { archived: ["true", "false"] },
    { search: { nested: "Julia" } },
  ])("rejects unexpected query structures", (query) => {
    expect(() => parseListInvitationsQuery(query)).toThrow(DomainError);
  });

  it("rejects unknown query parameters", () => {
    expect(() => parseListInvitationsQuery({ sort: "displayName" })).toThrow(
      /Parámetro de consulta no permitido/,
    );
  });
});
