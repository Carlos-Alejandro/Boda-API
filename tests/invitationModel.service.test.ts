import { describe, expect, it } from "vitest";

import { DomainError } from "../src/errors/DomainError";
import {
  changeInvitationCapacity,
  createInvitationData,
  restoreReplacement,
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
