import { describe, expect, it } from "vitest";

import { DomainError } from "../src/errors/DomainError";
import {
  changeInvitationCapacity,
  createInvitationData,
  restoreReplacement,
  removeGuest,
} from "../src/services/invitationModel.service";
import type { Guest, Invitation } from "../src/types/invitation";

function makeInvitation(guests: Guest[]): Invitation {
  return {
    id: "invitation-1",
    displayName: "Familia Pérez",
    maxGuests: guests.length,
    replacementsAllowed: true,
    rsvpStatus: "partial",
    message: "Mensaje existente",
    isArchived: false,
    archivedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    editOverrideUntil: new Date("2026-02-01T00:00:00.000Z"),
    guests,
  };
}

const knownGuest = (name = "Carlos Pérez", attending: boolean | null = null): Guest => ({
  name,
  shortName: name.split(" ")[0],
  type: "known",
  attending,
});

const openGuest = (name = "", attending: boolean | null = null): Guest => ({
  name,
  shortName: name ? name.split(" ")[0] : "Acompañante",
  type: "open",
  attending,
});

const replacementGuest = (): Guest => ({
  name: "Laura",
  shortName: "Laura",
  type: "replacement",
  attending: true,
  originalName: "Julia Pérez",
});

describe("createInvitationData", () => {
  it("creates an invitation with known guests", () => {
    const result = createInvitationData({ displayName: " Familia Pérez ", knownGuests: [{ name: " Carlos Pérez " }], openSlots: 0, replacementsAllowed: false });
    expect(result.displayName).toBe("Familia Pérez");
    expect(result.guests[0]).toEqual({ name: "Carlos Pérez", shortName: "Carlos", type: "known", attending: null });
  });

  it("creates known and open guests", () => {
    const result = createInvitationData({ displayName: "Familia", knownGuests: [{ name: "Ana" }], openSlots: 1, replacementsAllowed: true });
    expect(result.guests[1]).toEqual({ name: "", shortName: "Acompañante", type: "open", attending: null });
  });

  it("calculates maxGuests", () => {
    const result = createInvitationData({ displayName: "Familia", knownGuests: [{ name: "Ana" }, { name: "Luis" }], openSlots: 2, replacementsAllowed: true });
    expect(result.maxGuests).toBe(4);
    expect(result.guests).toHaveLength(4);
  });

  it("creates invitations as active and not archived", () => {
    const result = createInvitationData({ displayName: "Familia", knownGuests: [{ name: "Ana" }], openSlots: 0, replacementsAllowed: true });
    expect(result).toMatchObject({ isArchived: false, archivedAt: null });
  });

  it("derives shortName from the normalized first word", () => {
    const result = createInvitationData({ displayName: "Familia", knownGuests: [{ name: "  Carlos   Manuel Martínez  " }], openSlots: 0, replacementsAllowed: true });
    expect(result.guests[0]).toMatchObject({ name: "Carlos Manuel Martínez", shortName: "Carlos" });
  });

  it("rejects an empty displayName", () => {
    expect(() => createInvitationData({ displayName: "   ", knownGuests: [{ name: "Ana" }], openSlots: 0, replacementsAllowed: true })).toThrow(DomainError);
  });

  it("rejects an empty known guest", () => {
    expect(() => createInvitationData({ displayName: "Familia", knownGuests: [{ name: "   " }], openSlots: 0, replacementsAllowed: true })).toThrow(DomainError);
  });

  it("rejects negative openSlots", () => {
    expect(() => createInvitationData({ displayName: "Familia", knownGuests: [{ name: "Ana" }], openSlots: -1, replacementsAllowed: true })).toThrow(DomainError);
  });

  it("rejects decimal openSlots", () => {
    expect(() => createInvitationData({ displayName: "Familia", knownGuests: [{ name: "Ana" }], openSlots: 1.5, replacementsAllowed: true })).toThrow(DomainError);
  });

  it("rejects an invitation without slots", () => {
    expect(() => createInvitationData({ displayName: "Familia", knownGuests: [], openSlots: 0, replacementsAllowed: true })).toThrow(DomainError);
  });
});

describe("changeInvitationCapacity", () => {
  it("adds open guests when capacity increases", () => {
    const result = changeInvitationCapacity(makeInvitation([knownGuest(), openGuest()]), 4);
    expect(result.guests.slice(2)).toEqual([openGuest(), openGuest()]);
  });

  it("preserves existing guests and responses when capacity increases", () => {
    const invitation = makeInvitation([knownGuest("Carlos Pérez", true), replacementGuest()]);
    const result = changeInvitationCapacity(invitation, 3);
    expect(result.guests.slice(0, 2)).toEqual(invitation.guests);
    expect(result.rsvpStatus).toBe("partial");
  });

  it("returns a consistent copy when capacity is unchanged", () => {
    const invitation = makeInvitation([knownGuest(), openGuest()]);
    const result = changeInvitationCapacity(invitation, 2);
    expect(result).toEqual(invitation);
    expect(result).not.toBe(invitation);
    expect(result.guests).not.toBe(invitation.guests);
  });

  it("removes empty unused open guests", () => {
    const result = changeInvitationCapacity(makeInvitation([knownGuest(), openGuest(), openGuest()]), 1);
    expect(result.guests).toEqual([knownGuest()]);
  });

  it("does not remove a named open guest", () => {
    expect(() => changeInvitationCapacity(makeInvitation([knownGuest(), openGuest("Laura")]), 1)).toThrow(DomainError);
  });

  it("does not remove an attending open guest", () => {
    expect(() => changeInvitationCapacity(makeInvitation([knownGuest(), openGuest("", true)]), 1)).toThrow(DomainError);
  });

  it("does not remove a known guest", () => {
    expect(() => changeInvitationCapacity(makeInvitation([knownGuest(), knownGuest("Ana")]), 1)).toThrow(DomainError);
  });

  it("does not remove a replacement guest", () => {
    expect(() => changeInvitationCapacity(makeInvitation([knownGuest(), replacementGuest()]), 1)).toThrow(DomainError);
  });

  it("fails atomically when there are not enough removable slots", () => {
    const invitation = makeInvitation([knownGuest(), openGuest(), openGuest("Laura")]);
    expect(() => changeInvitationCapacity(invitation, 1)).toThrow(DomainError);
    expect(invitation.guests).toHaveLength(3);
  });

  it("always keeps guests.length equal to maxGuests", () => {
    const invitation = makeInvitation([knownGuest(), openGuest(), openGuest()]);
    for (const capacity of [1, 3, 5]) {
      const result = changeInvitationCapacity(invitation, capacity);
      expect(result.guests).toHaveLength(result.maxGuests);
    }
  });
});

describe("restoreReplacement", () => {
  it("restores a replacement as known", () => {
    expect(restoreReplacement(replacementGuest()).type).toBe("known");
  });

  it("restores originalName as the guest name", () => {
    expect(restoreReplacement(replacementGuest()).name).toBe("Julia Pérez");
  });

  it("recalculates shortName", () => {
    expect(restoreReplacement({ ...replacementGuest(), originalName: "  Julia   María Pérez " }).shortName).toBe("Julia");
  });

  it("resets attending to null", () => {
    expect(restoreReplacement(replacementGuest()).attending).toBeNull();
  });

  it("rejects a guest that is not a replacement", () => {
    expect(() => restoreReplacement(knownGuest())).toThrow(DomainError);
  });

  it("rejects a replacement without a valid originalName", () => {
    expect(() => restoreReplacement({ ...replacementGuest(), originalName: "   " })).toThrow(DomainError);
  });
});


describe("removeGuest", () => {
  it.each([
    knownGuest("Edgar", true), knownGuest("Edgar", false), knownGuest("Edgar", null),
    openGuest("", true), openGuest("", false), openGuest("", null),
    openGuest("Carlos", true), openGuest("Carlos", false), openGuest("Carlos", null),
  ])("removes $type with name '$name' attending $attending without mutating input", (guest) => {
    const input = makeInvitation([knownGuest("First"), guest, openGuest("Last")]);
    const before = structuredClone(input);
    const result = removeGuest(input, 1);
    expect(result).toEqual({ ...input, maxGuests: 2, guests: [input.guests[0], input.guests[2]] });
    expect(input).toEqual(before);
    expect(result.guests).not.toBe(input.guests);
  });
  it("removes a known from an all-known invitation", () => {
    const input = makeInvitation([knownGuest("Edgar"), knownGuest("Yoselin"), knownGuest("Americo"), knownGuest("Doricela")]);
    expect(removeGuest(input, 3).guests.map(g => g.name)).toEqual(["Edgar", "Yoselin", "Americo"]);
  });
  it("allows removing the last known when an open remains", () => {
    expect(removeGuest(makeInvitation([knownGuest(), openGuest()]), 0).guests).toEqual([openGuest()]);
  });
  it.each([knownGuest(), openGuest()])("rejects last $type", guest => {
    expect(() => removeGuest(makeInvitation([guest]), 0)).toThrow("La capacidad de la invitación debe ser un número entero mayor que cero");
  });
  it("rejects replacement", () => {
    expect(() => removeGuest(makeInvitation([replacementGuest(), knownGuest()]), 0)).toThrow("No se pueden eliminar invitados de reemplazo");
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 2])("rejects invalid index %s", index => {
    expect(() => removeGuest(makeInvitation([knownGuest(), openGuest()]), index)).toThrow(DomainError);
  });
  it.each(["pending", "partial", "confirmed", "declined"] as const)("preserves RSVP %s and replacement policy", rsvpStatus => {
    const input = { ...makeInvitation([knownGuest(), knownGuest()]), rsvpStatus, replacementsAllowed: false };
    expect(removeGuest(input, 0)).toMatchObject({ rsvpStatus, replacementsAllowed: false });
  });
  it("rejects inconsistent capacity", () => {
    expect(() => removeGuest({ ...makeInvitation([knownGuest(), openGuest()]), maxGuests: 3 }, 0)).toThrow(DomainError);
  });
});
