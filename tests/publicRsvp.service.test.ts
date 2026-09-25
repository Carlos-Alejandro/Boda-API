import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  runTransaction: vi.fn(),
  doc: vi.fn(() => ({ path: "invitations/ABC12345" })),
}));

vi.mock("../src/config/firebaseAdmin", () => ({
  firestore: {
    collection: vi.fn(() => ({ doc: mocks.doc })),
    runTransaction: mocks.runTransaction,
  },
}));

import { HttpError } from "../src/errors/HttpError";
import {
  buildPublicRsvpGuests,
  calculatePublicRsvpStatus,
  savePublicRsvp,
  serializePublicRsvpState,
} from "../src/services/publicRsvp.service";
import type { PublicRsvpInput, VersionedInvitation } from "../src/types/invitation";

const now = new Date("2027-01-01T00:00:00.000Z");

function invitation(overrides: Partial<VersionedInvitation> = {}): VersionedInvitation {
  return {
    id: "ABC12345",
    version: "v1",
    displayName: "Familia Pérez",
    maxGuests: 2,
    replacementsAllowed: true,
    rsvpStatus: "pending",
    message: "",
    isArchived: false,
    archivedAt: null,
    updatedAt: null,
    editOverrideUntil: null,
    guests: [
      { name: "Carlos Martínez", shortName: "Carlos", type: "known", attending: null },
      { name: "", shortName: "Acompañante", type: "open", attending: null },
    ],
    ...overrides,
  };
}

function snapshot(value: VersionedInvitation) {
  return {
    exists: true,
    id: value.id,
    ref: { path: `invitations/${value.id}` },
    updateTime: new Timestamp(100, 0),
    data: () => ({
      ...value,
      version: undefined,
      updatedAt: value.updatedAt ? Timestamp.fromDate(value.updatedAt) : null,
      archivedAt: value.archivedAt ? Timestamp.fromDate(value.archivedAt) : null,
      editOverrideUntil: value.editOverrideUntil ? Timestamp.fromDate(value.editOverrideUntil) : null,
    }),
  };
}

function input(base: VersionedInvitation, overrides: Partial<PublicRsvpInput> = {}): PublicRsvpInput {
  return {
    expectedState: serializePublicRsvpState(base),
    responses: [true, null],
    replacementNames: ["", ""],
    openGuestNames: ["", "Ana López"],
    message: " Gracias ",
    ...overrides,
  };
}

describe("public RSVP service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async (callback) => callback({ get: mocks.get, update: mocks.update }));
  });

  it("atomically derives guests, status and current-name search prefixes", async () => {
    const base = invitation();
    mocks.get.mockResolvedValue(snapshot(base));
    const result = await savePublicRsvp(base.id, input(base), now);
    expect(result).toMatchObject({ message: "Gracias", rsvpStatus: "confirmed" });
    expect(result.guests[1]).toMatchObject({ name: "Ana López", type: "open", attending: true });
    expect(mocks.update).toHaveBeenCalledOnce();
    const changes = mocks.update.mock.calls[0][1];
    expect(changes.updatedAt).toBe(FieldValue.serverTimestamp());
    expect(changes.searchPrefixes).toEqual(expect.arrayContaining(["ana", "lopez", "martinez"]));
  });

  it("creates and restores replacements without leaving the previous current name indexed", () => {
    const base = invitation({ maxGuests: 1, guests: [{ name: "Carlos Martínez", shortName: "Carlos", type: "known", attending: null }] });
    const replaced = buildPublicRsvpGuests(base, input(base, {
      responses: [false], replacementNames: ["Mariana López"], openGuestNames: [""],
    }));
    expect(replaced[0]).toEqual({ name: "Mariana López", shortName: "Mariana", type: "replacement", attending: true, originalName: "Carlos Martínez" });
    const replacementBase = invitation({ maxGuests: 1, guests: replaced });
    const restored = buildPublicRsvpGuests(replacementBase, input(replacementBase, {
      responses: [true], replacementNames: [""], openGuestNames: [""],
    }));
    expect(restored[0]).toEqual({ name: "Carlos Martínez", shortName: "Carlos", type: "known", attending: true });
  });

  it("derives declined and partial status", () => {
    expect(calculatePublicRsvpStatus([{ name: "A", shortName: "A", type: "known", attending: false }])).toBe("declined");
    expect(calculatePublicRsvpStatus([
      { name: "A", shortName: "A", type: "known", attending: true },
      { name: "B", shortName: "B", type: "known", attending: false },
    ])).toBe("partial");
  });

  it("rejects stale state without writing", async () => {
    const base = invitation();
    mocks.get.mockResolvedValue(snapshot({ ...base, message: "changed" }));
    await expect(savePublicRsvp(base.id, input(base), now)).rejects.toMatchObject({ code: "RSVP_CONFLICT" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["archived", invitation({ isArchived: true })],
    ["closed", invitation()],
  ])("rejects unavailable state: %s", async (reason, value) => {
    mocks.get.mockResolvedValue(value === null ? { exists: false } : snapshot(value));
    const date = reason === "closed" ? new Date("2029-01-01") : now;
    await expect(savePublicRsvp("ABC12345", input(invitation()), date)).rejects.toBeInstanceOf(HttpError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("allows a future override after the general deadline", async () => {
    const base = invitation({ editOverrideUntil: new Date("2030-01-01") });
    mocks.get.mockResolvedValue(snapshot(base));
    await expect(savePublicRsvp(base.id, input(base), new Date("2029-01-01"))).resolves.toBeTruthy();
  });

  it("rejects replacement input when replacements are disabled", () => {
    const base = invitation({
      maxGuests: 1,
      replacementsAllowed: false,
      guests: [{ name: "Carlos", shortName: "Carlos", type: "known", attending: null }],
    });
    expect(() => buildPublicRsvpGuests(base, input(base, {
      responses: [false], replacementNames: ["Mariana"], openGuestNames: [""],
    }))).toThrow(/no permite reemplazos/);
  });
});
