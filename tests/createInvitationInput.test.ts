import { describe, expect, it } from "vitest";

import { DomainError } from "../src/errors/DomainError";
import { parseCreateInvitationInput } from "../src/validation/createInvitationInput";

const validBody = {
  displayName: "Familia Pérez",
  knownGuests: [{ name: "Juan Pérez" }],
  openSlots: 1,
  replacementsAllowed: true,
};

describe("parseCreateInvitationInput", () => {
  it.each([null, [], "body"])("rejects a non-object body", (body) => {
    expect(() => parseCreateInvitationInput(body)).toThrow(DomainError);
  });

  it.each([
    { displayName: "" },
    { knownGuests: "Juan" },
    { knownGuests: [{ name: "" }] },
    { openSlots: -1 },
    { openSlots: 1.5 },
    { replacementsAllowed: "yes" },
  ])("rejects invalid input: %o", (change) => {
    expect(() => parseCreateInvitationInput({ ...validBody, ...change })).toThrow(
      DomainError,
    );
  });

  it.each(["id", "maxGuests", "guests", "rsvpStatus", "message", "updatedAt", "editOverrideUntil", "isArchived", "archivedAt"])(
    "rejects backend-controlled field %s",
    (field) => {
      expect(() => parseCreateInvitationInput({ ...validBody, [field]: "forced" })).toThrow(
        /Unexpected field/,
      );
    },
  );

  it("rejects an invitation without any guest slots", () => {
    expect(() =>
      parseCreateInvitationInput({ ...validBody, knownGuests: [], openSlots: 0 }),
    ).toThrow(DomainError);
  });
});
