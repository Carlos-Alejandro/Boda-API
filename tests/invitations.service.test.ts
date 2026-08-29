import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  document: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  updateDocument: vi.fn(),
}));

const idMocks = vi.hoisted(() => ({ generateInvitationId: vi.fn() }));

vi.mock("../src/config/firebaseAdmin", () => ({
  firestore: {
    collection: vi.fn(() => ({
      get: firestoreMocks.listDocuments,
      doc: firestoreMocks.document,
    })),
  },
}));

vi.mock("../src/services/invitationId.service", () => idMocks);

vi.mock("../src/services/invitationModel.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/invitationModel.service")>();
  return { ...actual, createInvitationData: vi.fn(actual.createInvitationData) };
});

import { DomainError } from "../src/errors/DomainError";
import {
  createInvitation,
  getInvitationById,
  listInvitations,
  mapInvitationDocument,
  updateInvitation,
} from "../src/services/invitations.service";
import { createInvitationData } from "../src/services/invitationModel.service";

function validDocument() {
  return {
    displayName: "Julia & Jordi",
    maxGuests: 2,
    replacementsAllowed: true,
    rsvpStatus: "confirmed",
    message: "Private message",
    updatedAt: Timestamp.fromDate(new Date("2026-08-01T10:00:00.000Z")),
    editOverrideUntil: null,
    guests: [
      { name: "Julia", shortName: "Julia", type: "known", attending: true },
      { name: "Jordi", shortName: "Jordi", type: "known", attending: true },
    ],
  };
}

describe("mapInvitationDocument", () => {
  it("maps a valid document and preserves its id", () => {
    const invitation = mapInvitationDocument("KM8P2XQ7", validDocument());
    expect(invitation).toMatchObject({
      id: "KM8P2XQ7",
      displayName: "Julia & Jordi",
      maxGuests: 2,
      rsvpStatus: "confirmed",
    });
  });

  it("maps Firestore Timestamps to Date and keeps null", () => {
    const invitation = mapInvitationDocument("KM8P2XQ7", validDocument());
    expect(invitation.updatedAt).toEqual(new Date("2026-08-01T10:00:00.000Z"));
    expect(invitation.editOverrideUntil).toBeNull();
  });

  it("rejects guests.length different from maxGuests", () => {
    expect(() =>
      mapInvitationDocument("bad-id", { ...validDocument(), maxGuests: 3 }),
    ).toThrowError(/guests length must equal maxGuests/);
  });

  it("rejects an invalid rsvpStatus", () => {
    expect(() =>
      mapInvitationDocument("bad-id", { ...validDocument(), rsvpStatus: "maybe" }),
    ).toThrow(DomainError);
  });

  it("rejects a replacement without originalName", () => {
    const data = validDocument();
    data.guests[0] = {
      name: "Laura",
      shortName: "Laura",
      type: "replacement",
      attending: true,
    };

    expect(() => mapInvitationDocument("bad-id", data)).toThrowError(
      /originalName is required/,
    );
  });
});

describe("Firestore reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.document.mockReturnValue({
      create: firestoreMocks.createDocument,
      get: firestoreMocks.getDocument,
      update: firestoreMocks.updateDocument,
    });
  });

  it("returns null when getInvitationById does not find a document", async () => {
    firestoreMocks.getDocument.mockResolvedValue({ exists: false, id: "missing" });
    await expect(getInvitationById("missing")).resolves.toBeNull();
  });

  it("listInvitations keeps each Firestore document id", async () => {
    firestoreMocks.listDocuments.mockResolvedValue({
      docs: [{ id: "KM8P2XQ7", data: () => validDocument() }],
    });

    await expect(listInvitations()).resolves.toEqual([
      expect.objectContaining({ id: "KM8P2XQ7" }),
    ]);
  });
});

describe("createInvitation", () => {
  const input = {
    displayName: "Familia Pérez",
    knownGuests: [{ name: "Juan Pérez" }],
    openSlots: 1,
    replacementsAllowed: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    idMocks.generateInvitationId.mockReturnValue("AB2CD3EF");
    firestoreMocks.document.mockReturnValue({
      create: firestoreMocks.createDocument,
      get: firestoreMocks.getDocument,
      update: firestoreMocks.updateDocument,
    });
    firestoreMocks.createDocument.mockResolvedValue(undefined);
  });

  it("uses createInvitationData and creates the expected initial model", async () => {
    firestoreMocks.getDocument
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        id: "AB2CD3EF",
        data: () => ({
          ...validDocument(),
          displayName: "Familia Pérez",
          rsvpStatus: "pending",
        }),
      });

    await createInvitation(input);

    expect(createInvitationData).toHaveBeenCalledWith(input);
    expect(firestoreMocks.createDocument).toHaveBeenCalledOnce();
    expect(firestoreMocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        rsvpStatus: "pending",
        maxGuests: 2,
        guests: [
          expect.objectContaining({ type: "known", name: "Juan Pérez" }),
          expect.objectContaining({ type: "open", name: "" }),
        ],
        updatedAt: expect.anything(),
      }),
    );
  });

  it("generates another id after a collision", async () => {
    idMocks.generateInvitationId
      .mockReturnValueOnce("COLLIDE2")
      .mockReturnValueOnce("AB2CD3EF");
    firestoreMocks.getDocument
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        id: "AB2CD3EF",
        data: () => ({ ...validDocument(), rsvpStatus: "pending" }),
      });

    await createInvitation(input);

    expect(idMocks.generateInvitationId).toHaveBeenCalledTimes(2);
    expect(firestoreMocks.document).toHaveBeenNthCalledWith(1, "COLLIDE2");
    expect(firestoreMocks.document).toHaveBeenNthCalledWith(2, "AB2CD3EF");
    expect(firestoreMocks.createDocument).toHaveBeenCalledOnce();
  });

  it("fails safely after too many collisions without writing", async () => {
    idMocks.generateInvitationId.mockReturnValue("COLLIDE2");
    firestoreMocks.getDocument.mockResolvedValue({ exists: true });

    await expect(createInvitation(input)).rejects.toThrow(
      "Could not generate a unique invitation ID",
    );
    expect(idMocks.generateInvitationId).toHaveBeenCalledTimes(10);
    expect(firestoreMocks.createDocument).not.toHaveBeenCalled();
  });
});

describe("updateInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.document.mockReturnValue({
      create: firestoreMocks.createDocument,
      get: firestoreMocks.getDocument,
      update: firestoreMocks.updateDocument,
    });
    firestoreMocks.updateDocument.mockResolvedValue(undefined);
  });

  function mockExistingAndUpdated(overrides: Record<string, unknown> = {}) {
    firestoreMocks.getDocument
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({
        exists: true,
        id: "KM8P2XQ7",
        data: () => ({ ...validDocument(), ...overrides }),
      });
  }

  it("updates displayName without guests or maxGuests", async () => {
    mockExistingAndUpdated({ displayName: "Familia Actualizada" });
    const result = await updateInvitation("KM8P2XQ7", {
      displayName: "Familia Actualizada",
    });

    expect(result?.displayName).toBe("Familia Actualizada");
    expect(firestoreMocks.updateDocument).toHaveBeenCalledWith({
      displayName: "Familia Actualizada",
      updatedAt: expect.anything(),
    });
    const changes = firestoreMocks.updateDocument.mock.calls[0][0];
    expect(changes).not.toHaveProperty("guests");
    expect(changes).not.toHaveProperty("maxGuests");
  });

  it("updates replacementsAllowed", async () => {
    mockExistingAndUpdated({ replacementsAllowed: false });
    await updateInvitation("KM8P2XQ7", { replacementsAllowed: false });
    expect(firestoreMocks.updateDocument).toHaveBeenCalledWith({
      replacementsAllowed: false,
      updatedAt: expect.anything(),
    });
  });

  it("writes editOverrideUntil as a Timestamp", async () => {
    const date = new Date("2026-09-01T12:30:00.000Z");
    mockExistingAndUpdated({ editOverrideUntil: Timestamp.fromDate(date) });
    await updateInvitation("KM8P2XQ7", { editOverrideUntil: date });
    expect(firestoreMocks.updateDocument).toHaveBeenCalledWith({
      editOverrideUntil: Timestamp.fromDate(date),
      updatedAt: expect.anything(),
    });
  });

  it("writes null editOverrideUntil", async () => {
    mockExistingAndUpdated({ editOverrideUntil: null });
    await updateInvitation("KM8P2XQ7", { editOverrideUntil: null });
    expect(firestoreMocks.updateDocument).toHaveBeenCalledWith({
      editOverrideUntil: null,
      updatedAt: expect.anything(),
    });
  });

  it("uses serverTimestamp for updatedAt", async () => {
    mockExistingAndUpdated();
    await updateInvitation("KM8P2XQ7", { replacementsAllowed: true });
    expect(firestoreMocks.updateDocument.mock.calls[0][0].updatedAt).toEqual(
      FieldValue.serverTimestamp(),
    );
  });

  it("returns null without updating when the invitation does not exist", async () => {
    firestoreMocks.getDocument.mockResolvedValueOnce({ exists: false });
    await expect(
      updateInvitation("missing", { displayName: "Familia" }),
    ).resolves.toBeNull();
    expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
  });
});
