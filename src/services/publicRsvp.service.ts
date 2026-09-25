import { FieldValue } from "firebase-admin/firestore";

import { firestore } from "../config/firebaseAdmin";
import { DomainError } from "../errors/DomainError";
import { HttpError } from "../errors/HttpError";
import type { Guest, PublicRsvpInput, VersionedInvitation } from "../types/invitation";
import { parseInvitationId } from "../validation/invitationId";
import { buildInvitationSearchPrefixes } from "./invitationSearch.service";
import { mapInvitationSnapshot } from "./invitations.service";

export const RSVP_CLOSE_DATE = new Date("2028-03-12T05:00:00.000Z");

function dateValue(value: Date | null): number | null {
  return value?.getTime() ?? null;
}

export function serializePublicRsvpState(invitation: VersionedInvitation): string {
  return JSON.stringify({
    id: invitation.id,
    maxGuests: invitation.maxGuests,
    replacementsAllowed: invitation.replacementsAllowed,
    isArchived: invitation.isArchived,
    archivedAt: dateValue(invitation.archivedAt),
    editOverrideUntil: dateValue(invitation.editOverrideUntil),
    rsvpStatus: invitation.rsvpStatus,
    message: invitation.message,
    guests: invitation.guests.map(({ name, shortName, type, attending, originalName }) =>
      [name, shortName, type, attending, originalName ?? null]),
  });
}

function normalizeSubmittedName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function requireUsableName(value: string, field: string): string {
  const name = normalizeSubmittedName(value);
  if (name.length < 2) throw new DomainError(`${field} debe tener al menos 2 caracteres`);
  return name;
}

function originalGuest(guest: Guest): Pick<Guest, "name" | "shortName"> {
  if (guest.type === "replacement") {
    const name = normalizeSubmittedName(guest.originalName ?? "");
    if (!name) throw new DomainError("El invitado de reemplazo no tiene un nombre original válido");
    return { name, shortName: name.split(" ")[0] || guest.shortName };
  }
  return { name: guest.name, shortName: guest.shortName };
}

export function buildPublicRsvpGuests(
  current: VersionedInvitation,
  input: PublicRsvpInput,
): Guest[] {
  if (
    input.responses.length !== current.maxGuests ||
    input.replacementNames.length !== current.maxGuests ||
    input.openGuestNames.length !== current.maxGuests
  ) {
    throw new DomainError("La cantidad de respuestas no coincide con la invitación");
  }

  return current.guests.map((guest, index) => {
    const replacementName = normalizeSubmittedName(input.replacementNames[index] ?? "");
    const openGuestName = normalizeSubmittedName(input.openGuestNames[index] ?? "");

    if (guest.type === "open") {
      if (replacementName) throw new DomainError(`replacementNames[${index}] no corresponde a un espacio abierto`);
      if (!openGuestName) {
        return { name: "", shortName: "Acompañante", type: "open", attending: false };
      }
      const name = requireUsableName(openGuestName, `openGuestNames[${index}]`);
      return { name, shortName: name.split(" ")[0] || "Acompañante", type: "open", attending: true };
    }

    if (openGuestName) throw new DomainError(`openGuestNames[${index}] no corresponde a un espacio abierto`);
    const response = input.responses[index];
    if (response !== true && response !== false) {
      throw new DomainError(`responses[${index}] debe confirmar o declinar al invitado`);
    }
    const original = originalGuest(guest);
    if (response === true) {
      if (replacementName) throw new DomainError(`replacementNames[${index}] no aplica a una confirmación`);
      return { ...original, type: "known", attending: true };
    }
    if (replacementName) {
      if (!current.replacementsAllowed) {
        throw new DomainError("Esta invitación no permite reemplazos");
      }
      const name = requireUsableName(replacementName, `replacementNames[${index}]`);
      return {
        name,
        shortName: name.split(" ")[0] || name,
        type: "replacement",
        attending: true,
        originalName: original.name,
      };
    }
    return { ...original, type: "known", attending: false };
  });
}

export function calculatePublicRsvpStatus(guests: readonly Guest[]): "confirmed" | "partial" | "declined" {
  const attending = guests.filter((guest) => guest.attending === true).length;
  if (attending === 0) return "declined";
  return guests.some((guest) => guest.type === "known" && guest.attending === false)
    ? "partial"
    : "confirmed";
}

function unavailable(): never {
  throw new HttpError(
    409,
    "RSVP_UNAVAILABLE",
    "La invitación no permite guardar una respuesta en este momento.",
  );
}

export async function savePublicRsvp(
  rawId: string,
  input: PublicRsvpInput,
  now = new Date(),
): Promise<VersionedInvitation> {
  const id = parseInvitationId(rawId);
  const document = firestore.collection("invitations").doc(id);
  const result = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) unavailable();
    const current = mapInvitationSnapshot(snapshot);
    const hasOverride = current.editOverrideUntil !== null && now < current.editOverrideUntil;
    if (current.isArchived || (now >= RSVP_CLOSE_DATE && !hasOverride)) unavailable();
    if (serializePublicRsvpState(current) !== input.expectedState) {
      throw new HttpError(
        409,
        "RSVP_CONFLICT",
        "La invitación cambió. Actualiza la información antes de volver a guardar.",
      );
    }

    const guests = buildPublicRsvpGuests(current, input);
    const rsvpStatus = calculatePublicRsvpStatus(guests);
    const message = input.message.trim();
    transaction.update(document, {
      guests,
      message,
      rsvpStatus,
      searchPrefixes: buildInvitationSearchPrefixes(id, current.displayName, guests),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ...current, guests, message, rsvpStatus };
  });
  return result;
}
