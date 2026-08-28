import { DomainError } from "../errors/DomainError";
import type {
  CreateInvitationInput,
  Guest,
  Invitation,
  InvitationData,
} from "../types/invitation";

const OPEN_GUEST_SHORT_NAME = "Acompañante";

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function getShortName(name: string): string {
  return normalizeName(name).split(" ")[0];
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
    throw new DomainError("Known guest name cannot be empty");
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
    throw new DomainError("Invitation capacity must be a positive integer");
  }
}

function assertInvitationInvariant(invitation: Invitation): void {
  if (invitation.guests.length !== invitation.maxGuests) {
    throw new DomainError("Invitation guests must match its capacity");
  }
}

export function createInvitationData(
  input: CreateInvitationInput,
): InvitationData {
  const displayName = input.displayName.trim();

  if (!displayName) {
    throw new DomainError("Invitation display name cannot be empty");
  }

  if (!Number.isInteger(input.openSlots) || input.openSlots < 0) {
    throw new DomainError("Open slots must be a non-negative integer");
  }

  const knownGuests = input.knownGuests.map(({ name }) =>
    createKnownGuest(name),
  );
  const openGuests = Array.from({ length: input.openSlots }, createOpenGuest);
  const guests = [...knownGuests, ...openGuests];

  if (guests.length === 0) {
    throw new DomainError("Invitation must have at least one guest slot");
  }

  return {
    displayName,
    maxGuests: guests.length,
    replacementsAllowed: input.replacementsAllowed,
    rsvpStatus: "pending",
    message: "",
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
    throw new DomainError("Invitation capacity cannot be reduced safely");
  }

  const indexesToRemove = new Set(removableIndexes);
  const reducedGuests = guests.filter((_, index) => !indexesToRemove.has(index));

  return { ...invitation, maxGuests: newMaxGuests, guests: reducedGuests };
}

export function restoreReplacement(guest: Guest): Guest {
  if (guest.type !== "replacement") {
    throw new DomainError("Only a replacement guest can be restored");
  }

  const originalName = normalizeName(guest.originalName ?? "");

  if (!originalName) {
    throw new DomainError("Replacement guest must have a valid original name");
  }

  return {
    name: originalName,
    shortName: getShortName(originalName),
    type: "known",
    attending: null,
  };
}
