import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
}));

vi.mock("../src/config/firebaseAdmin", () => ({
  firestore: {
    collection: vi.fn(() => ({
      get: firestoreMocks.listDocuments,
      doc: vi.fn(() => ({ get: firestoreMocks.getDocument })),
    })),
  },
}));

import { DomainError } from "../src/errors/DomainError";
import {
  getInvitationById,
  listInvitations,
  mapInvitationDocument,
} from "../src/services/invitations.service";

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
  beforeEach(() => vi.clearAllMocks());

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
