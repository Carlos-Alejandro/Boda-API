import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { createInvitationData } from "../src/services/invitationModel.service";
import { invitationCreationFingerprint, invitationCreationReceiptId, parseInvitationCreationReceipt } from "../src/services/invitationCreationReceipt.service";
import { parseIdempotencyKey } from "../src/validation/idempotencyKey";
import { DomainError } from "../src/errors/DomainError";
import { DataIntegrityError } from "../src/errors/DataIntegrityError";

const input = { displayName: "Familia Ruiz", knownGuests: [{ name: "José Carlos" }, { name: "María Ruiz" }], openSlots: 2, replacementsAllowed: false };
const fingerprint = invitationCreationFingerprint(createInvitationData(input));

describe("creation fingerprint", () => {
  it("uses model normalization and ignores JSON property order", () => {
    expect(invitationCreationFingerprint(createInvitationData({
      replacementsAllowed: false, openSlots: 2,
      knownGuests: [{ name: "  José   Carlos\t " }, { name: "María Ruiz" }], displayName: "  Familia Ruiz  ",
    }))).toBe(fingerprint);
  });
  it.each([
    { displayName: "Familia Otra" }, { displayName: "Familia  Ruiz" },
    { knownGuests: [{ name: "José Carlos" }] },
    { knownGuests: [...input.knownGuests].reverse() },
    { knownGuests: [{ name: "Jose Carlos" }, input.knownGuests[1]] },
    { openSlots: 3 }, { replacementsAllowed: true },
  ])("includes every logical change %j", change => {
    expect(invitationCreationFingerprint(createInvitationData({ ...input, ...change }))).not.toBe(fingerprint);
  });
  it("excludes mutable and server-generated state", () => {
    const data = createInvitationData(input);
    expect(invitationCreationFingerprint({ ...data, updatedAt: new Date(), rsvpStatus: "confirmed" })).toBe(fingerprint);
  });
});

describe("Idempotency-Key and receipt", () => {
  it("allows absence and a single bounded key", () => {
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
    for (const key of ["abc", "UUID-123_456.v1:row", "a".repeat(200)]) expect(parseIdempotencyKey(key)).toBe(key);
  });
  it.each(["", " ", "a".repeat(201), "a,b", "a b", "a/b", "ñ", "a\n", ["a"], ["a", "a"], [], null, 1])("rejects %j", value => {
    expect(() => parseIdempotencyKey(value)).toThrow(DomainError);
  });
  it("hashes the key into a stable safe document ID, preserving case", () => {
    const id = invitationCreationReceiptId("example.key");
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(id).toBe(invitationCreationReceiptId("example.key"));
    expect(id).not.toBe(invitationCreationReceiptId("Example.key"));
  });
  it("validates the receipt fields", () => {
    expect(parseInvitationCreationReceipt({ fingerprint, invitationId: "ABCDEFGH", createdAt: new Timestamp(1, 0) })).toEqual({ fingerprint, invitationId: "ABCDEFGH" });
  });
  it.each([null, [], {}, { fingerprint: "bad", invitationId: "ABCDEFGH", createdAt: new Timestamp(1, 0) },
    { fingerprint, invitationId: "a/b", createdAt: new Timestamp(1, 0) },
    { fingerprint, invitationId: "ABCDEFGH", createdAt: "yesterday" },
  ])("rejects corrupt receipts %j", receipt => {
    expect(() => parseInvitationCreationReceipt(receipt)).toThrow(DataIntegrityError);
  });
});
