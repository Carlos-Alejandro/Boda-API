import { randomBytes } from "node:crypto";

export const INVITATION_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITATION_ID_LENGTH = 8;
const MAX_ACCEPTABLE_BYTE =
  Math.floor(256 / INVITATION_ID_ALPHABET.length) * INVITATION_ID_ALPHABET.length;

export function generateInvitationId(
  getRandomBytes: (size: number) => Uint8Array = randomBytes,
): string {
  let id = "";

  while (id.length < INVITATION_ID_LENGTH) {
    for (const byte of getRandomBytes(INVITATION_ID_LENGTH - id.length)) {
      if (byte >= MAX_ACCEPTABLE_BYTE) continue;
      id += INVITATION_ID_ALPHABET[byte % INVITATION_ID_ALPHABET.length];
    }
  }

  return id;
}
