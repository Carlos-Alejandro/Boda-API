import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { DataIntegrityError } from "../errors/DataIntegrityError";
import type { InvitationData } from "../types/invitation";
import { parseInvitationId } from "../validation/invitationId";

export const INVITATION_CREATION_RECEIPTS = "invitationCreationReceipts";

export function invitationCreationReceiptId(key: string): string {
  return createHash("sha256").update("invitation-creation-key:v1\n" + key).digest("hex");
}

// Hash only logical input, after the existing creation model has normalized it.
// Fixed property order and a version prefix make the encoding explicit and stable.
export function invitationCreationFingerprint(data: InvitationData): string {
  const canonical = JSON.stringify({
    displayName: data.displayName,
    knownGuests: data.guests.filter(guest => guest.type === "known").map(guest => guest.name),
    openSlots: data.guests.filter(guest => guest.type === "open").length,
    replacementsAllowed: data.replacementsAllowed,
  });
  return "v1:" + createHash("sha256").update("invitation-creation-input:v1\n" + canonical).digest("hex");
}

export function parseInvitationCreationReceipt(value: unknown): { fingerprint: string; invitationId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DataIntegrityError("Invalid invitation creation receipt");
  }
  const data = value as Record<string, unknown>;
  if (typeof data.fingerprint !== "string" || !/^v1:[a-f0-9]{64}$/.test(data.fingerprint) ||
    typeof data.invitationId !== "string" || !(data.createdAt instanceof Timestamp)) {
    throw new DataIntegrityError("Invalid invitation creation receipt fields");
  }
  try {
    parseInvitationId(data.invitationId);
  } catch {
    throw new DataIntegrityError("Invalid invitation creation receipt reference");
  }
  return { fingerprint: data.fingerprint, invitationId: data.invitationId };
}
