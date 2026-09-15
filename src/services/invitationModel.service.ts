import { DomainError } from "../errors/DomainError";
import type {
  CreateInvitationInput,
  Guest,
  Invitation,
  InvitationData,
} from "../types/invitation";

const OPEN_GUEST_SHORT_NAME = "Acompañante";

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function getShortName(name: string): string {
  return normalizeName(name).split(" ")[0];
}

export function updateGuestName<T extends Guest>(guest: T, name: string): T {
  const normalizedName = normalizeName(name);
  if (!normalizedName) throw new DomainError("name debe ser un texto no vacío");
  if (!guest.name.trim()) {
    throw new DomainError(guest.type === "open"
      ? "Este espacio abierto todavía no tiene una persona asignada."
      : "El invitado todavía no tiene una persona identificada.");
  }
  return { ...guest, name: normalizedName, shortName: getShortName(normalizedName) };
}

function createOpenGuest(): Guest {
  return {
    name: "",
    shortName: OPEN_GUEST_SHORT_NAME,
    type: "open",
    attending: null,
  };
}

function createKnownGuest(name: string): Guest {
  const normalizedName = normalizeName(name);

  if (!normalizedName) {
    throw new DomainError("El nombre del invitado conocido no puede estar vacío");
  }

  return {
    name: normalizedName,
    shortName: getShortName(normalizedName),
    type: "known",
    attending: null,
  };
}

function assertValidCapacity(capacity: number): void {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new DomainError("La capacidad de la invitación debe ser un número entero mayor que cero");
  }
}

function assertInvitationInvariant(invitation: Invitation): void {
  if (invitation.guests.length !== invitation.maxGuests) {
    throw new DomainError("La cantidad de invitados debe coincidir con la capacidad de la invitación");
  }
}

export function createInvitationData(
  input: CreateInvitationInput,
): InvitationData {
  const displayName = input.displayName.trim();

  if (!displayName) {
    throw new DomainError("El nombre para mostrar de la invitación no puede estar vacío");
  }

  if (!Number.isInteger(input.openSlots) || input.openSlots < 0) {
    throw new DomainError("La cantidad de lugares disponibles debe ser un número entero mayor o igual a cero");
  }

  const knownGuests = input.knownGuests.map(({ name }) =>
    createKnownGuest(name),
  );
  const openGuests = Array.from({ length: input.openSlots }, createOpenGuest);
  const guests = [...knownGuests, ...openGuests];

  if (guests.length === 0) {
    throw new DomainError("La invitación debe tener al menos un lugar para un invitado");
  }

  return {
    displayName,
    maxGuests: guests.length,
    replacementsAllowed: input.replacementsAllowed,
    rsvpStatus: "pending",
    message: "",
    isArchived: false,
    archivedAt: null,
    updatedAt: null,
    editOverrideUntil: null,
    guests,
  };
}

export function changeInvitationCapacity(
  invitation: Invitation,
  newMaxGuests: number,
): Invitation {
  assertInvitationInvariant(invitation);
  assertValidCapacity(newMaxGuests);

  const guests = invitation.guests.map((guest) => ({ ...guest }));

  if (newMaxGuests > invitation.maxGuests) {
    const addedGuests = Array.from(
      { length: newMaxGuests - invitation.maxGuests },
      createOpenGuest,
    );

    return { ...invitation, maxGuests: newMaxGuests, guests: [...guests, ...addedGuests] };
  }

  if (newMaxGuests === invitation.maxGuests) {
    return { ...invitation, guests };
  }

  const slotsToRemove = invitation.maxGuests - newMaxGuests;
  const removableIndexes = guests
    .map((guest, index) => ({ guest, index }))
    .filter(
      ({ guest }) =>
        guest.type === "open" &&
        normalizeName(guest.name) === "" &&
        guest.attending !== true,
    )
    .map(({ index }) => index)
    .slice(-slotsToRemove);

  if (removableIndexes.length < slotsToRemove) {
    throw new DomainError("No se puede reducir la capacidad de la invitación de forma segura");
  }

  const indexesToRemove = new Set(removableIndexes);
  const reducedGuests = guests.filter((_, index) => !indexesToRemove.has(index));

  return { ...invitation, maxGuests: newMaxGuests, guests: reducedGuests };
}

export function restoreReplacement(guest: Guest): Guest {
  if (guest.type !== "replacement") {
    throw new DomainError("Solo se puede restaurar al invitado original de un invitado de reemplazo");
  }

  const originalName = normalizeName(guest.originalName ?? "");

  if (!originalName) {
    throw new DomainError("El invitado de reemplazo debe tener un nombre original válido");
  }

  return {
    name: originalName,
    shortName: getShortName(originalName),
    type: "known",
    attending: null,
  };
}

export function removeGuest(invitation: Invitation, guestIndex: number): Invitation {
  assertInvitationInvariant(invitation);
  assertValidCapacity(invitation.maxGuests);
  if (!Number.isSafeInteger(guestIndex) || guestIndex < 0) {
    throw new DomainError("guestIndex debe ser un número entero mayor o igual a cero");
  }
  if (guestIndex >= invitation.guests.length) {
    throw new DomainError("guestIndex está fuera de rango");
  }
  const guest = invitation.guests[guestIndex];
  if (guest.type === "replacement") {
    throw new DomainError("No se pueden eliminar invitados de reemplazo");
  }
  if (guest.type !== "known" && guest.type !== "open") {
    throw new DomainError("No se pueden eliminar invitados de este tipo");
  }
  const maxGuests = invitation.maxGuests - 1;
  assertValidCapacity(maxGuests);
  const result = {
    ...invitation,
    maxGuests,
    guests: invitation.guests.filter((_, index) => index !== guestIndex),
  };
  assertInvitationInvariant(result);
  return result;
}
