import { describe, expect, it } from "vitest";
import { parseUpdateGuestInput } from "../src/validation/updateGuestInput";
import { DomainError } from "../src/errors/DomainError";
describe("parseUpdateGuestInput", () => {
  it.each([ ["Ana", "Ana"], ["  Ana  ", "Ana"], ["  José   Carlos\tMartínez ", "José Carlos Martínez"] ])("normalizes %s", (name, expected) => {
    expect(parseUpdateGuestInput({ name })).toEqual({ name: expected });
  });
  it.each([undefined, null, [], "Ana", 3, {}, ...["", "   ", null, 1, [], {}, false].map(name => ({ name })), ...["unknown", "", "shortName", "attending", "type", "originalName"].flatMap(key => [{ [key]: true }, { name: "Ana", [key]: true }])])("rejects %j", body => {
    expect(() => parseUpdateGuestInput(body)).toThrow(DomainError);
  });
});
