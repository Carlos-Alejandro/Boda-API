import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { firestore } from "../config/firebaseAdmin";
import { DomainError } from "../errors/DomainError";
import type {
  CreateInvitationInput,
  Guest,
  GuestType,
  Invitation,
  RsvpStatus,
  UpdateInvitationInput,
} from "../types/invitation";
import { generateInvitationId } from "./invitationId.service";
import {
  changeInvitationCapacity,
  createInvitationData,
  restoreReplacement,
} from "./invitationModel.service";

const RSVP_STATUSES = new Set<RsvpStatus>([
  "pending",
  "confirmed",
  "partial",
  "declined",
]);
const GUEST_TYPES = new Set<GuestType>(["known", "open", "replacement"]);
const MAX_ID_ATTEMPTS = 10;

function invalidDocument(id: string, detail: string): never {
  throw new DomainError(`Invalid invitation document "${id}": ${detail}`);
}

function requireObject(id: string, value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidDocument(id, `${field} must be an object`);
  }

  return value as Record<string, unknown>;
}

function mapTimestamp(id: string, value: unknown, field: string): Date | null {
  if (value === null) return null;
  if (!(value instanceof Timestamp)) {
    invalidDocument(id, `${field} must be a Firestore Timestamp or null`);
  }

  const date = value.toDate();
  if (Number.isNaN(date.getTime())) invalidDocument(id, `${field} is invalid`);
  return date;
}

function mapGuest(id: string, value: unknown, index: number): Guest {
  const guest = requireObject(id, value, `guests[${index}]`);
  const prefix = `guests[${index}]`;

  if (typeof guest.name !== "string") invalidDocument(id, `${prefix}.name must be a string`);
  if (typeof guest.shortName !== "string" || !guest.shortName.trim()) {
    invalidDocument(id, `${prefix}.shortName must be a non-empty string`);
  }
  if (typeof guest.type !== "string" || !GUEST_TYPES.has(guest.type as GuestType)) {
    invalidDocument(id, `${prefix}.type is invalid`);
  }
  if (guest.attending !== null && typeof guest.attending !== "boolean") {
    invalidDocument(id, `${prefix}.attending must be a boolean or null`);
  }

  if (guest.type === "replacement") {
    if (typeof guest.originalName !== "string" || !guest.originalName.trim()) {
      invalidDocument(id, `${prefix}.originalName is required for a replacement`);
    }
  } else if (guest.originalName !== undefined && typeof guest.originalName !== "string") {
    invalidDocument(id, `${prefix}.originalName must be a string when present`);
  }

  return {
    name: guest.name,
    shortName: guest.shortName,
    type: guest.type as GuestType,
    attending: guest.attending as boolean | null,
    ...(guest.originalName === undefined ? {} : { originalName: guest.originalName as string }),
  };
}

export function mapInvitationDocument(id: string, value: unknown): Invitation {
  const data = requireObject(id, value, "data");

  if (typeof data.displayName !== "string" || !data.displayName.trim()) {
    invalidDocument(id, "displayName must be a non-empty string");
  }
  if (!Number.isInteger(data.maxGuests) || (data.maxGuests as number) < 1) {
    invalidDocument(id, "maxGuests must be a positive integer");
  }
  if (!Array.isArray(data.guests)) invalidDocument(id, "guests must be an array");
  if (data.guests.length !== data.maxGuests) {
    invalidDocument(id, "guests length must equal maxGuests");
  }
  if (typeof data.replacementsAllowed !== "boolean") {
    invalidDocument(id, "replacementsAllowed must be a boolean");
  }
  if (typeof data.rsvpStatus !== "string" || !RSVP_STATUSES.has(data.rsvpStatus as RsvpStatus)) {
    invalidDocument(id, "rsvpStatus is invalid");
  }
  if (typeof data.message !== "string") invalidDocument(id, "message must be a string");

  return {
    id,
    displayName: data.displayName,
    maxGuests: data.maxGuests as number,
    replacementsAllowed: data.replacementsAllowed,
    rsvpStatus: data.rsvpStatus as RsvpStatus,
    message: data.message,
    editOverrideUntil: mapTimestamp(id, data.editOverrideUntil, "editOverrideUntil"),
    updatedAt: mapTimestamp(id, data.updatedAt, "updatedAt"),
    guests: data.guests.map((guest, index) => mapGuest(id, guest, index)),
  };
}

export async function listInvitations(): Promise<Invitation[]> {
  const snapshot = await firestore.collection("invitations").get();
  return snapshot.docs.map((document) => mapInvitationDocument(document.id, document.data()));
}

export async function getInvitationById(id: string): Promise<Invitation | null> {
  const document = await firestore.collection("invitations").doc(id).get();
  if (!document.exists) return null;
  return mapInvitationDocument(document.id, document.data());
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<Invitation> {
  const invitationData = createInvitationData(input);
  const collection = firestore.collection("invitations");

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const id = generateInvitationId();
    const document = collection.doc(id);
    const existing = await document.get();
    if (existing.exists) continue;

    await document.create({
      ...invitationData,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const created = await document.get();
    if (!created.exists) {
      throw new Error("Created invitation could not be read back");
    }
    return mapInvitationDocument(created.id, created.data());
  }

  throw new Error("Could not generate a unique invitation ID");
}

export async function updateInvitation(
  id: string,
  input: UpdateInvitationInput,
): Promise<Invitation | null> {
  const document = firestore.collection("invitations").doc(id);
  const existing = await document.get();
  if (!existing.exists) return null;

  const changes: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.displayName !== undefined) changes.displayName = input.displayName;
  if (input.replacementsAllowed !== undefined) {
    changes.replacementsAllowed = input.replacementsAllowed;
  }
  if (input.editOverrideUntil !== undefined) {
    changes.editOverrideUntil =
      input.editOverrideUntil === null
        ? null
        : Timestamp.fromDate(input.editOverrideUntil);
  }

  await document.update(changes);

  const updated = await document.get();
  if (!updated.exists) throw new Error("Updated invitation could not be read back");
  return mapInvitationDocument(updated.id, updated.data());
}

export async function changeCapacity(
  id: string,
  newMaxGuests: number,
): Promise<Invitation | null> {
  const document = firestore.collection("invitations").doc(id);
  const result = await firestore.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(document);
    if (!currentSnapshot.exists) return null;

    const current = mapInvitationDocument(
      currentSnapshot.id,
      currentSnapshot.data(),
    );
    if (newMaxGuests === current.maxGuests) {
      return { invitation: current, changed: false } as const;
    }

    const changed = changeInvitationCapacity(current, newMaxGuests);
    transaction.update(document, {
      guests: changed.guests,
      maxGuests: changed.maxGuests,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { invitation: changed, changed: true } as const;
  });

  if (!result) return null;
  if (!result.changed) return result.invitation;

  const updated = await document.get();
  if (!updated.exists) throw new Error("Updated invitation could not be read back");
  return mapInvitationDocument(updated.id, updated.data());
}

export async function restoreInvitationReplacement(
  id: string,
  guestIndex: number,
): Promise<Invitation | null> {
  const document = firestore.collection("invitations").doc(id);
  const exists = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return false;

    const current = mapInvitationDocument(snapshot.id, snapshot.data());
    if (guestIndex < 0 || guestIndex >= current.guests.length) {
      throw new DomainError("guestIndex is out of range");
    }

    const guests = current.guests.map((guest, index) =>
      index === guestIndex ? restoreReplacement(guest) : guest,
    );
    transaction.update(document, {
      guests,
      rsvpStatus: "pending",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!exists) return null;

  const updated = await document.get();
  if (!updated.exists) throw new Error("Updated invitation could not be read back");
  return mapInvitationDocument(updated.id, updated.data());
}
