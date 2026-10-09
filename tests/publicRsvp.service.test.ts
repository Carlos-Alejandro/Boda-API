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
import { DomainError } from "../src/errors/DomainError";
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

  it("keeps empty open places pending unless the invitation is explicitly declined", () => {
    const openGuests = [
      { name: "", shortName: "Acompañante", type: "open" as const, attending: false },
      { name: "", shortName: "Acompañante", type: "open" as const, attending: false },
    ];
    expect(calculatePublicRsvpStatus(openGuests)).toBe("pending");
    expect(calculatePublicRsvpStatus(openGuests, true)).toBe("declined");
  });

  it("rejects an empty open-only response without writing, preserving an existing decline", async () => {
    const base = invitation({
      maxGuests: 2,
      rsvpStatus: "declined",
      guests: [
        { name: "", shortName: "Acompañante", type: "open", attending: false },
        { name: "", shortName: "Acompañante", type: "open", attending: false },
      ],
    });
    mocks.get.mockResolvedValue(snapshot(base));

    await expect(savePublicRsvp(base.id, input(base, {
      responses: [null, null], replacementNames: ["", ""], openGuestNames: ["", ""], message: "",
    }), now)).rejects.toMatchObject({ statusCode: 400, code: "RSVP_EMPTY" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("stores an explicit open-only decline", async () => {
    const base = invitation({
      maxGuests: 2,
      guests: [
        { name: "", shortName: "Acompañante", type: "open", attending: null },
        { name: "", shortName: "Acompañante", type: "open", attending: null },
      ],
    });
    mocks.get.mockResolvedValue(snapshot(base));

    const result = await savePublicRsvp(base.id, input(base, {
      declineAll: true,
      responses: [null, null], replacementNames: ["", ""], openGuestNames: ["", ""], message: "",
    }), now);
    expect(result.rsvpStatus).toBe("declined");
    expect(result.guests.every((guest) => guest.name === "" && guest.type === "open")).toBe(true);
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it("rejects declineAll for invitations with known people without writing", async () => {
    const base = invitation({
      maxGuests: 1,
      guests: [{ name: "Carlos", shortName: "Carlos", type: "known", attending: null }],
    });
    mocks.get.mockResolvedValue(snapshot(base));

    await expect(savePublicRsvp(base.id, input(base, {
      declineAll: true,
      responses: [false], replacementNames: [""], openGuestNames: [""],
    }), now)).rejects.toThrow(DomainError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["a confirmation", [true, null], ["", ""], ["", ""]],
    ["an identified open guest", [null, null], ["", ""], ["Ana López", ""]],
    ["a replacement name", [null, null], ["Mariana", ""], ["", ""]],
  ])("rejects declineAll combined with %s without writing", async (_case, responses, replacementNames, openGuestNames) => {
    const base = invitation({
      maxGuests: 2,
      guests: [
        { name: "", shortName: "Acompañante", type: "open", attending: null },
        { name: "", shortName: "Acompañante", type: "open", attending: null },
      ],
    });
    mocks.get.mockResolvedValue(snapshot(base));

    await expect(savePublicRsvp(base.id, input(base, {
      declineAll: true,
      responses,
      replacementNames,
      openGuestNames,
    }), now)).rejects.toThrow(DomainError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("clears previously identified open guests when explicitly declining", async () => {
    const base = invitation({
      maxGuests: 2,
      guests: [
        { name: "Ana López", shortName: "Ana", type: "open", attending: true },
        { name: "", shortName: "Acompañante", type: "open", attending: false },
      ],
    });
    mocks.get.mockResolvedValue(snapshot(base));

    const result = await savePublicRsvp(base.id, input(base, {
      declineAll: true,
      responses: [null, null], replacementNames: ["", ""], openGuestNames: ["", ""], message: "",
    }), now);

    expect(result.rsvpStatus).toBe("declined");
    expect(result.guests.every((guest) => guest.name === "" && guest.type === "open")).toBe(true);
  });

  it("keeps a known-person decline when the guest edits only the message", async () => {
    const base = invitation({
      maxGuests: 1,
      rsvpStatus: "declined",
      guests: [{ name: "Carlos", shortName: "Carlos", type: "known", attending: false }],
    });
    mocks.get.mockResolvedValue(snapshot(base));

    const result = await savePublicRsvp(base.id, input(base, {
      responses: [false], replacementNames: [""], openGuestNames: [""], message: "No podremos asistir",
    }), now);

    expect(result.rsvpStatus).toBe("declined");
    expect(result.message).toBe("No podremos asistir");
  });

  it("confirms a named open guest while leaving remaining open places empty", async () => {
    const base = invitation({
      maxGuests: 2,
      guests: [
        { name: "", shortName: "Acompañante", type: "open", attending: null },
        { name: "", shortName: "Acompañante", type: "open", attending: null },
      ],
    });
    mocks.get.mockResolvedValue(snapshot(base));

    const result = await savePublicRsvp(base.id, input(base, {
      responses: [null, null], replacementNames: ["", ""], openGuestNames: ["Ana López", ""],
    }), now);
    expect(result.rsvpStatus).toBe("confirmed");
    expect(result.guests[1]).toMatchObject({ name: "", type: "open", attending: false });
  });

  it.each([
    [[true, true], "confirmed"],
    [[true, false], "partial"],
  ] as const)("changes a previously declined invitation to %s after valid answers", async (responses, expectedStatus) => {
    const base = invitation({
      maxGuests: 2,
      rsvpStatus: "declined",
      guests: [
        { name: "Carlos", shortName: "Carlos", type: "known", attending: false },
        { name: "Ana", shortName: "Ana", type: "known", attending: false },
      ],
    });
    mocks.get.mockResolvedValue(snapshot(base));

    const result = await savePublicRsvp(base.id, input(base, {
      responses: [...responses], replacementNames: ["", ""], openGuestNames: ["", ""],
    }), now);

    expect(result.rsvpStatus).toBe(expectedStatus);
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it.each([
    ["known decline", [false], "declined"],
    ["combined known answers", [true, false], "partial"],
  ] as const)("preserves %s status calculation", async (_case, responses, expectedStatus) => {
    const knownGuests = responses.map((_, index) => ({
      name: `Invitado ${index + 1}`,
      shortName: `Invitado${index + 1}`,
      type: "known" as const,
      attending: null,
    }));
    const base = invitation({ maxGuests: knownGuests.length, guests: knownGuests });
    mocks.get.mockResolvedValue(snapshot(base));

    const result = await savePublicRsvp(base.id, input(base, {
      responses: [...responses],
      replacementNames: responses.map(() => ""),
      openGuestNames: responses.map(() => ""),
    }), now);

    expect(result.rsvpStatus).toBe(expectedStatus);
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
