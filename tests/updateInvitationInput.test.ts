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

  it("converts an ISO editOverrideUntil to Date", () => {
    expect(
      parseUpdateInvitationInput({ editOverrideUntil: "2026-09-01T12:30:00.000Z" }),
    ).toEqual({ editOverrideUntil: new Date("2026-09-01T12:30:00.000Z") });
  });

  it("accepts null editOverrideUntil", () => {
    expect(parseUpdateInvitationInput({ editOverrideUntil: null })).toEqual({
      editOverrideUntil: null,
    });
  });

  it.each(["not-a-date", "2026-02-30T12:00:00.000Z"])(
    "rejects invalid date %s",
    (editOverrideUntil) => {
      expect(() => parseUpdateInvitationInput({ editOverrideUntil })).toThrow(DomainError);
    },
  );

  it("rejects an empty body", () => {
    expect(() => parseUpdateInvitationInput({})).toThrow(/At least one field/);
  });

  it.each(["id", "maxGuests", "guests", "rsvpStatus", "message", "updatedAt"])(
    "rejects forbidden field %s",
    (field) => {
      expect(() => parseUpdateInvitationInput({ [field]: "forced" })).toThrow(
        /Unexpected field/,
      );
    },
  );
});
