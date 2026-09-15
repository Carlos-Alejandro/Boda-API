import { describe, expect, it } from "vitest";

import { DomainError } from "../src/errors/DomainError";
import { parseUpdateInvitationInput } from "../src/validation/updateInvitationInput";

describe("parseUpdateInvitationInput", () => {
  it("trims displayName", () => {
    expect(parseUpdateInvitationInput({ displayName: "  Familia Pérez  " })).toEqual({
      displayName: "Familia Pérez",
    });
  });

  it("accepts replacementsAllowed", () => {
    expect(parseUpdateInvitationInput({ replacementsAllowed: false })).toEqual({
      replacementsAllowed: false,
    });
  });

  it.each(["2026-09-01T12:30:00.000Z", "2026-09-01T07:30:00-05:00"])("converts ISO %s to the same Date", editOverrideUntil => {
    expect(
      parseUpdateInvitationInput({ editOverrideUntil }),
    ).toEqual({ editOverrideUntil: new Date("2026-09-01T12:30:00.000Z") });
  });

  it("accepts null editOverrideUntil", () => {
    expect(parseUpdateInvitationInput({ editOverrideUntil: null })).toEqual({
      editOverrideUntil: null,
    });
  });

  it.each(["not-a-date", "2026-02-30T12:00:00.000Z", "2028-03-15T12:30:00", "2028-03-15", "2028-03-15T12:30Z", 123, {}, [], false, undefined])(
    "rejects invalid date %s",
    (editOverrideUntil) => {
      expect(() => parseUpdateInvitationInput({ editOverrideUntil })).toThrow(DomainError);
    },
  );

  it("rejects an empty body", () => {
    expect(() => parseUpdateInvitationInput({})).toThrow(/Se requiere al menos un campo/);
  });

  it("keeps combined input semantics and explicit null presence", () => {
    const input = parseUpdateInvitationInput({ displayName: "  Familia Pérez  ", replacementsAllowed: false, editOverrideUntil: null });
    expect(input).toEqual({ displayName: "Familia Pérez", replacementsAllowed: false, editOverrideUntil: null });
    expect(Object.hasOwn(input, "editOverrideUntil")).toBe(true);
    expect(Object.hasOwn(parseUpdateInvitationInput({ displayName: "Family" }), "editOverrideUntil")).toBe(false);
  });

  it.each(["id", "maxGuests", "guests", "rsvpStatus", "message", "updatedAt", "isArchived", "archivedAt"])(
    "rejects forbidden field %s",
    (field) => {
      expect(() => parseUpdateInvitationInput({ [field]: "forced" })).toThrow(
        /Campo no permitido/,
      );
    },
  );
});
