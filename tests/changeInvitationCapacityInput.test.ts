import { describe, expect, it } from "vitest";

import { DomainError } from "../src/errors/DomainError";
import { parseChangeInvitationCapacityInput } from "../src/validation/changeInvitationCapacityInput";

describe("parseChangeInvitationCapacityInput", () => {
  it("accepts a positive integer", () => {
    expect(parseChangeInvitationCapacityInput({ maxGuests: 3 })).toEqual({
      maxGuests: 3,
    });
  });

  it.each([null, [], {}, { maxGuests: "3" }, { maxGuests: 0 }, { maxGuests: -1 }, { maxGuests: 2.5 }])(
    "rejects invalid body %o",
    (body) => {
      expect(() => parseChangeInvitationCapacityInput(body)).toThrow(DomainError);
    },
  );

  it.each([{ maxGuests: 3, guests: [] }, { maxGuests: 3, rsvpStatus: "pending" }])(
    "rejects extra fields in %o",
    (body) => {
      expect(() => parseChangeInvitationCapacityInput(body)).toThrow(
        /only maxGuests/,
      );
    },
  );
});
