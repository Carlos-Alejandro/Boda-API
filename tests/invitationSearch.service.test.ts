import { describe, expect, it } from "vitest";

import {
  buildInvitationSearchPrefixes,
  normalizeInvitationSearch,
} from "../src/services/invitationSearch.service";

describe("invitation search prefixes", () => {
  it("normalizes case, whitespace, punctuation and diacritics", () => {
    expect(normalizeInvitationSearch("  América   &  José  ")).toBe("america jose");
  });

  it("indexes code, full-name prefixes and each word for surname search", () => {
    const tokens = buildInvitationSearchPrefixes(
      "ABC12345",
      "Familia Pérez",
      [{ name: "Carlos Martínez" }, { name: "Andrea Pérez" }],
    );
    for (const token of ["abc12345", "familia p", "perez", "carl", "carlos m", "mart", "martinez", "andrea p"]) {
      expect(tokens).toContain(token);
    }
  });

  it("contains only current guest names when rebuilt", () => {
    const tokens = buildInvitationSearchPrefixes("ABC12345", "Familia", [{ name: "Mariana Nueva" }]);
    expect(tokens).toContain("mariana");
    expect(tokens).not.toContain("carlos");
  });
});
