import { describe, expect, it } from "vitest";

import {
  generateInvitationId,
  INVITATION_ID_ALPHABET,
} from "../src/services/invitationId.service";

describe("generateInvitationId", () => {
  it("generates an 8-character id", () => {
    expect(generateInvitationId()).toHaveLength(8);
  });

  it("uses only allowed non-ambiguous characters", () => {
    const id = generateInvitationId();
    expect(id).toMatch(new RegExp(`^[${INVITATION_ID_ALPHABET}]{8}$`));
    expect(id).not.toMatch(/[O0I1L]/);
  });
});
