import { describe, expect, it } from "vitest";

import { DomainError } from "../src/errors/DomainError";
import { parseGuestIndex } from "../src/validation/guestIndex";

describe("parseGuestIndex", () => {
  it.each([["0", 0], ["12", 12]])("parses %s", (value, expected) => {
    expect(parseGuestIndex(value)).toBe(expected);
  });

  it.each(["-1", "1.5", "", "01", "NaN"])("rejects invalid index %s", (value) => {
    expect(() => parseGuestIndex(value)).toThrow(DomainError);
  });
});
