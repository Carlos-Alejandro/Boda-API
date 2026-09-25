import { describe, expect, it } from "vitest";

import { DomainError } from "../src/errors/DomainError";
import { parsePublicRsvpInput } from "../src/validation/publicRsvpInput";

const valid = () => ({
  expectedState: "expected",
  responses: [true, null],
  replacementNames: ["", ""],
  openGuestNames: ["", "Ana"],
  message: "Gracias",
});

describe("parsePublicRsvpInput", () => {
  it("accepts only the public RSVP contract", () => {
    expect(parsePublicRsvpInput(valid())).toEqual(valid());
  });

  it.each(["displayName", "maxGuests", "replacementsAllowed", "searchPrefixes", "rsvpStatus"])(
    "rejects administrative field %s",
    (field) => expect(() => parsePublicRsvpInput({ ...valid(), [field]: "forbidden" })).toThrow(DomainError),
  );

  it("rejects mismatched arrays and oversized inputs", () => {
    expect(() => parsePublicRsvpInput({ ...valid(), responses: [true] })).toThrow(/misma longitud/);
    expect(() => parsePublicRsvpInput({ ...valid(), message: "x".repeat(501) })).toThrow(/500/);
    expect(() => parsePublicRsvpInput({ ...valid(), openGuestNames: ["", "x".repeat(101)] })).toThrow(/100/);
  });
});
