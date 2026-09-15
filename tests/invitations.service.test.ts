import { invitationVersion } from "../src/services/invitationVersion.service";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  document: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  runTransaction: vi.fn(),
  transactionGet: vi.fn(),
  transactionUpdate: vi.fn(),
  updateDocument: vi.fn(),
}));

const idMocks = vi.hoisted(() => ({ generateInvitationId: vi.fn() }));

vi.mock("../src/config/firebaseAdmin", () => ({
  firestore: {
    collection: vi.fn(() => ({
      get: firestoreMocks.listDocuments,
      doc: firestoreMocks.document,
    })),
    runTransaction: firestoreMocks.runTransaction,
  },
}));

vi.mock("../src/services/invitationId.service", () => idMocks);

vi.mock("../src/services/invitationModel.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/invitationModel.service")>();
  return {
    ...actual,
    changeInvitationCapacity: vi.fn(actual.changeInvitationCapacity),
    createInvitationData: vi.fn(actual.createInvitationData),
    restoreReplacement: vi.fn(actual.restoreReplacement),
  };
});

import { DomainError } from "../src/errors/DomainError";
import { DataIntegrityError } from "../src/errors/DataIntegrityError";
import {
  archiveInvitation,
  changeCapacity,
  createInvitation,
  getInvitationById,
  listInvitations,
  mapInvitationDocument,
  removeInvitationGuest,
  updateInvitationGuest,
  mapInvitationSnapshot,
  restoreInvitationReplacement,
  restoreArchivedInvitation,
  updateInvitation,
} from "../src/services/invitations.service";
import {
  changeInvitationCapacity,
  createInvitationData,
  restoreReplacement,
} from "../src/services/invitationModel.service";

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

  it("treats legacy documents without archive fields as active", () => {
    const invitation = mapInvitationDocument("legacy", validDocument());
    expect(invitation).toMatchObject({ isArchived: false, archivedAt: null });
  });

  it("maps archived and explicitly active documents", () => {
    const archivedAt = Timestamp.fromDate(new Date("2026-08-20T10:00:00.000Z"));
    expect(
      mapInvitationDocument("archived", {
        ...validDocument(),
        isArchived: true,
        archivedAt,
      }),
    ).toMatchObject({
      isArchived: true,
      archivedAt: new Date("2026-08-20T10:00:00.000Z"),
    });
    expect(
      mapInvitationDocument("active", {
        ...validDocument(),
        isArchived: false,
        archivedAt: null,
      }),
    ).toMatchObject({ isArchived: false, archivedAt: null });
  });

  it("rejects guests.length different from maxGuests", () => {
    expect(() =>
      mapInvitationDocument("bad-id", { ...validDocument(), maxGuests: 3 }),
    ).toThrowError(/guests length must equal maxGuests/);
  });

  it("rejects an invalid rsvpStatus", () => {
    expect(() =>
      mapInvitationDocument("bad-id", { ...validDocument(), rsvpStatus: "maybe" }),
    ).toThrow(DataIntegrityError);
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
      docs: [{ id: "KM8P2XQ7", ref: { path: "invitations/KM8P2XQ7" }, updateTime: new Timestamp(100, 123456000), data: () => validDocument() }],
    });

    await expect(listInvitations()).resolves.toEqual([
      expect.objectContaining({ id: "KM8P2XQ7" }),
    ]);
  });

  function listDocument(
    id: string,
    displayName: string,
    rsvpStatus: "pending" | "confirmed" | "partial" | "declined",
    isArchived?: boolean,
  ) {
    return {
      id,
      ref: { path: `invitations/${id}` },
      updateTime: new Timestamp(100, 123456000),
      data: () => ({
        ...validDocument(),
        displayName,
        rsvpStatus,
        ...(isArchived === undefined
          ? {}
          : { isArchived, archivedAt: null }),
      }),
    };
  }

  function mockInvitationList() {
    firestoreMocks.listDocuments.mockResolvedValue({
      docs: [
        listDocument("JW2NRV5C", "Julia & Jordi", "confirmed", false),
        listDocument("LEGACY22", "Familia Perez", "pending"),
        listDocument("ARCHIVE1", "Julia Archivada", "partial", true),
        listDocument("ACTIVE44", "Familia Lopez", "declined", false),
      ],
    });
  }

  it("returns every mapped invitation without filters", async () => {
    mockInvitationList();
    const result = await listInvitations();
    expect(result.map(({ id }) => id)).toEqual([
      "JW2NRV5C",
      "LEGACY22",
      "ARCHIVE1",
      "ACTIVE44",
    ]);
  });

  it.each([
    ["Julia & Jordi", ["JW2NRV5C"]],
    ["julia", ["JW2NRV5C", "ARCHIVE1"]],
    ["JuLiA", ["JW2NRV5C", "ARCHIVE1"]],
    ["  Julia & Jordi  ", ["JW2NRV5C"]],
    ["jw2", ["JW2NRV5C"]],
  ] as const)("filters search=%s by id or displayName", async (search, ids) => {
    mockInvitationList();
    const result = await listInvitations({ search });
    expect(result.map(({ id }) => id)).toEqual(ids);
  });

  it.each([
    ["pending", ["LEGACY22"]],
    ["confirmed", ["JW2NRV5C"]],
    ["partial", ["ARCHIVE1"]],
    ["declined", ["ACTIVE44"]],
  ] as const)("filters rsvpStatus=%s", async (rsvpStatus, ids) => {
    mockInvitationList();
    const result = await listInvitations({ rsvpStatus });
    expect(result.map(({ id }) => id)).toEqual(ids);
  });

  it("filters archived=true and excludes legacy documents", async () => {
    mockInvitationList();
    const result = await listInvitations({ archived: true });
    expect(result.map(({ id }) => id)).toEqual(["ARCHIVE1"]);
  });

  it("filters archived=false and includes legacy documents", async () => {
    mockInvitationList();
    const result = await listInvitations({ archived: false });
    expect(result.map(({ id }) => id)).toEqual([
      "JW2NRV5C",
      "LEGACY22",
      "ACTIVE44",
    ]);
  });

  it.each([
    [{ search: "Julia", rsvpStatus: "confirmed" as const }, ["JW2NRV5C"]],
    [{ search: "Julia", archived: true }, ["ARCHIVE1"]],
    [{ rsvpStatus: "pending" as const, archived: false }, ["LEGACY22"]],
    [
      { search: "Julia", rsvpStatus: "confirmed" as const, archived: false },
      ["JW2NRV5C"],
    ],
    [
      { search: "Julia", rsvpStatus: "declined" as const, archived: true },
      [],
    ],
  ] as const)("combines filters with AND: %j", async (filters, ids) => {
    mockInvitationList();
    const result = await listInvitations(filters);
    expect(result.map(({ id }) => id)).toEqual(ids);
  });

  it("maps every document before filtering", async () => {
    firestoreMocks.listDocuments.mockResolvedValue({
      docs: [
        listDocument("MATCH", "Julia", "confirmed", false),
        { id: "INVALID", ref: { path: "invitations/INVALID" }, updateTime: new Timestamp(100, 123456000), data: () => ({ ...validDocument(), maxGuests: 0 }) },
      ],
    });

    await expect(listInvitations({ search: "Julia" })).rejects.toThrow(
      /Invalid invitation document/,
    );
  });

  it("does not issue writes while filtering", async () => {
    mockInvitationList();
    await listInvitations({ search: "Julia", archived: false });
    expect(firestoreMocks.createDocument).not.toHaveBeenCalled();
    expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.runTransaction).not.toHaveBeenCalled();
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
        id: "AB2CD3EF", ref: { path: "invitations/AB2CD3EF" }, updateTime: new Timestamp(100, 123456000), data: () => ({
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
        archivedAt: null,
        isArchived: false,
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
        id: "AB2CD3EF", ref: { path: "invitations/AB2CD3EF" }, updateTime: new Timestamp(100, 123456000), data: () => ({ ...validDocument(), rsvpStatus: "pending" }),
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
        id: "KM8P2XQ7", ref: { path: "invitations/KM8P2XQ7" }, updateTime: new Timestamp(100, 123456000), data: () => ({ ...validDocument(), ...overrides }),
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

describe("changeCapacity", () => {
  const knownGuest = {
    name: "Julia",
    shortName: "Julia",
    type: "known",
    attending: true,
  };
  const openGuest = {
    name: "",
    shortName: "Acompañante",
    type: "open",
    attending: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.document.mockReturnValue({
      create: firestoreMocks.createDocument,
      get: firestoreMocks.getDocument,
      update: firestoreMocks.updateDocument,
    });
    firestoreMocks.runTransaction.mockImplementation(async (callback) =>
      callback({
        get: firestoreMocks.transactionGet,
        update: firestoreMocks.transactionUpdate,
      }),
    );
  });

  function snapshot(guests: Array<Record<string, unknown>>, overrides = {}) {
    return {
      exists: true,
      id: "KM8P2XQ7", ref: { path: "invitations/KM8P2XQ7" }, updateTime: new Timestamp(100, 123456000), data: () => ({
        ...validDocument(),
        maxGuests: guests.length,
        guests,
        ...overrides,
      }),
    };
  }

  it.each([3, 5])("increases capacity from 2 to %i with correct open slots", async (capacity) => {
    const currentGuests = [knownGuest, openGuest];
    const updatedGuests = [
      ...currentGuests,
      ...Array.from({ length: capacity - 2 }, () => ({ ...openGuest })),
    ];
    firestoreMocks.transactionGet.mockResolvedValueOnce(snapshot(currentGuests));
    firestoreMocks.getDocument.mockResolvedValueOnce(snapshot(updatedGuests));

    const result = await changeCapacity("KM8P2XQ7", capacity);

    expect(changeInvitationCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ id: "KM8P2XQ7", guests: currentGuests }),
      capacity,
    );
    expect(result?.guests.slice(0, 2)).toEqual(currentGuests);
    expect(result?.guests.slice(2)).toEqual(
      Array.from({ length: capacity - 2 }, () => openGuest),
    );
    expect(result?.guests).toHaveLength(result?.maxGuests ?? 0);
  });

  it("reduces only removable open slots and preserves remaining order", async () => {
    const attendingOpen = { ...openGuest, name: "Laura", shortName: "Laura", attending: true };
    const currentGuests = [knownGuest, openGuest, attendingOpen, openGuest];
    const expectedGuests = [knownGuest, attendingOpen];
    firestoreMocks.transactionGet.mockResolvedValueOnce(snapshot(currentGuests));
    firestoreMocks.getDocument.mockResolvedValueOnce(snapshot(expectedGuests));

    const result = await changeCapacity("KM8P2XQ7", 2);

    expect(result?.guests).toEqual(expectedGuests);
    expect(firestoreMocks.transactionUpdate).toHaveBeenCalledWith(
      expect.anything(),
      {
      guests: expectedGuests,
      maxGuests: 2,
      updatedAt: expect.anything(),
      },
    );
  });

  it("writes only guests, maxGuests and updatedAt while preserving other fields", async () => {
    const currentGuests = [knownGuest, openGuest];
    const updatedGuests = [...currentGuests, { ...openGuest }];
    const preserved = {
      message: "Private message",
      replacementsAllowed: false,
      rsvpStatus: "partial",
    };
    firestoreMocks.transactionGet.mockResolvedValueOnce(
      snapshot(currentGuests, preserved),
    );
    firestoreMocks.getDocument.mockResolvedValueOnce(
      snapshot(updatedGuests, preserved),
    );

    const result = await changeCapacity("KM8P2XQ7", 3);
    expect(Object.keys(firestoreMocks.transactionUpdate.mock.calls[0][1]).sort()).toEqual([
      "guests",
      "maxGuests",
      "updatedAt",
    ]);
    expect(result).toMatchObject(preserved);
  });

  it("does not write when capacity cannot be reduced safely", async () => {
    const currentGuests = [knownGuest, { ...knownGuest, name: "Jordi", shortName: "Jordi" }];
    firestoreMocks.transactionGet.mockResolvedValueOnce(snapshot(currentGuests));

    await expect(changeCapacity("KM8P2XQ7", 1)).rejects.toThrow(DomainError);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it("returns null without writing when the invitation does not exist", async () => {
    firestoreMocks.transactionGet.mockResolvedValueOnce({ exists: false });
    await expect(changeCapacity("missing", 3)).resolves.toBeNull();
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it("does not write or reread when capacity is unchanged", async () => {
    const currentGuests = [knownGuest, openGuest];
    firestoreMocks.transactionGet.mockResolvedValueOnce(snapshot(currentGuests));

    const result = await changeCapacity("KM8P2XQ7", 2);

    expect(result).toMatchObject({ maxGuests: 2, guests: currentGuests });
    expect(changeInvitationCapacity).not.toHaveBeenCalled();
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });

  it("calculates from the latest guests read inside the transaction", async () => {
    const latestAttendingGuest = {
      ...openGuest,
      name: "Laura",
      shortName: "Laura",
      attending: true,
    };
    const replacementGuest = {
      name: "Carlos",
      shortName: "Carlos",
      type: "replacement",
      attending: true,
      originalName: "Jordi",
    };
    const latestGuests = [knownGuest, latestAttendingGuest, replacementGuest, openGuest];
    const updatedGuests = [knownGuest, latestAttendingGuest, replacementGuest];
    firestoreMocks.transactionGet.mockResolvedValueOnce(snapshot(latestGuests));
    firestoreMocks.getDocument.mockResolvedValueOnce(snapshot(updatedGuests));

    await changeCapacity("KM8P2XQ7", 3);

    expect(firestoreMocks.runTransaction).toHaveBeenCalledOnce();
    expect(changeInvitationCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ guests: latestGuests }),
      3,
    );
    expect(firestoreMocks.transactionUpdate.mock.calls[0][1].guests).toEqual(
      updatedGuests,
    );
  });
});

describe("restoreInvitationReplacement", () => {
  const version = invitationVersion("invitations/KM8P2XQ7", new Timestamp(100, 123456000));
  const knownGuest = {
    name: "Julia",
    shortName: "Julia",
    type: "known",
    attending: true,
  };
  const replacementGuest = {
    name: "Andrea",
    shortName: "Andrea",
    type: "replacement",
    attending: true,
    originalName: "Julia Muñoz Alejandro",
  };
  const restoredGuest = {
    name: "Julia Muñoz Alejandro",
    shortName: "Julia",
    type: "known",
    attending: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.document.mockReturnValue({
      get: firestoreMocks.getDocument,
    });
    firestoreMocks.runTransaction.mockImplementation(async (callback) =>
      callback({
        get: firestoreMocks.transactionGet,
        update: firestoreMocks.transactionUpdate,
      }),
    );
  });

  function snapshot(
    guests: Array<Record<string, unknown>>,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      exists: true,
      id: "KM8P2XQ7", ref: { path: "invitations/KM8P2XQ7" }, updateTime: new Timestamp(100, 123456000), data: () => ({
        ...validDocument(),
        maxGuests: guests.length,
        guests,
        ...overrides,
      }),
    };
  }

  it("rejects a stale version using the current transactional snapshot without reading outside or writing", async () => {
    const current = snapshot([knownGuest, replacementGuest]);
    current.updateTime = new Timestamp(101, 0);
    firestoreMocks.transactionGet.mockResolvedValueOnce(current);
    await expect(restoreInvitationReplacement("KM8P2XQ7", 1, version)).rejects.toMatchObject({
      statusCode: 412, code: "PRECONDITION_FAILED",
      message: "La invitación cambió. Recarga los datos antes de restaurar al invitado original.",
    });
    expect(firestoreMocks.transactionGet).toHaveBeenCalledWith(firestoreMocks.document.mock.results[0].value);
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(restoreReplacement).not.toHaveBeenCalled();
  });

  it("rechecks the version when Firestore retries with a newer snapshot", async () => {
    const current = snapshot([knownGuest, replacementGuest]);
    const newer = { ...current, updateTime: new Timestamp(101, 0) };
    firestoreMocks.transactionGet.mockResolvedValueOnce(current).mockResolvedValueOnce(newer);
    firestoreMocks.runTransaction.mockImplementationOnce(async callback => {
      const transaction = { get: firestoreMocks.transactionGet, update: firestoreMocks.transactionUpdate };
      await callback(transaction); // Discard the first attempt, as on a Firestore conflict.
      firestoreMocks.transactionUpdate.mockClear();
      return callback(transaction);
    });
    await expect(restoreInvitationReplacement("KM8P2XQ7", 1, version)).rejects.toMatchObject({ statusCode: 412 });
    expect(firestoreMocks.transactionGet).toHaveBeenCalledTimes(2);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });

  it("restores only the selected replacement using the transactional snapshot", async () => {
    const latestKnownGuest = { ...knownGuest, attending: false };
    const currentGuests = [latestKnownGuest, replacementGuest];
    const updatedGuests = [latestKnownGuest, restoredGuest];
    const preserved = {
      message: "Mensaje privado conservado",
      replacementsAllowed: false,
      isArchived: true,
    };
    firestoreMocks.transactionGet.mockResolvedValueOnce(
      snapshot(currentGuests, { ...preserved, rsvpStatus: "confirmed" }),
    );
    firestoreMocks.getDocument.mockResolvedValueOnce(
      { ...snapshot(updatedGuests, { ...preserved, rsvpStatus: "pending" }), updateTime: new Timestamp(101, 0) },
    );

    const result = await restoreInvitationReplacement("KM8P2XQ7", 1, version);

    expect(firestoreMocks.runTransaction).toHaveBeenCalledOnce();
    expect(restoreReplacement).toHaveBeenCalledWith(replacementGuest);
    expect(result?.version).toBe(invitationVersion("invitations/KM8P2XQ7", new Timestamp(101, 0)));
    expect(result?.version).not.toBe(version);
    expect(result?.isArchived).toBe(true);
    expect(result?.guests).toEqual(updatedGuests);
    expect(result?.guests).toHaveLength(result?.maxGuests ?? 0);
    expect(result?.guests[0]).toEqual(latestKnownGuest);
    expect(result?.guests[1]).toEqual(restoredGuest);
    expect(result?.guests[1]).not.toHaveProperty("originalName");
    expect(result).toMatchObject({
      maxGuests: 2,
      message: preserved.message,
      replacementsAllowed: preserved.replacementsAllowed,
      rsvpStatus: "pending",
    });
  });

  it("writes only guests, pending rsvpStatus and updatedAt", async () => {
    const updatedGuests = [knownGuest, restoredGuest];
    firestoreMocks.transactionGet.mockResolvedValueOnce(
      snapshot([knownGuest, replacementGuest]),
    );
    firestoreMocks.getDocument.mockResolvedValueOnce(
      snapshot(updatedGuests, { rsvpStatus: "pending" }),
    );

    await restoreInvitationReplacement("KM8P2XQ7", 1, version);

    expect(Object.keys(firestoreMocks.transactionUpdate.mock.calls[0][1]).sort()).toEqual([
      "guests",
      "rsvpStatus",
      "updatedAt",
    ]);
    expect(firestoreMocks.transactionUpdate.mock.calls[0][1]).toEqual({
      guests: updatedGuests,
      rsvpStatus: "pending",
      updatedAt: expect.anything(),
    });
  });

  it("rejects an out-of-range guestIndex without writing", async () => {
    firestoreMocks.transactionGet.mockResolvedValueOnce(snapshot([knownGuest]));
    await expect(restoreInvitationReplacement("KM8P2XQ7", 1, version)).rejects.toThrow(
      /fuera de rango/,
    );
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-replacement guest without writing", async () => {
    firestoreMocks.transactionGet.mockResolvedValueOnce(snapshot([knownGuest]));
    await expect(restoreInvitationReplacement("KM8P2XQ7", 0, version)).rejects.toThrow(
      /Solo se puede restaurar al invitado original/,
    );
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a replacement without originalName without writing", async () => {
    const invalidReplacement = { ...replacementGuest, originalName: "" };
    firestoreMocks.transactionGet.mockResolvedValueOnce(snapshot([invalidReplacement]));
    await expect(restoreInvitationReplacement("KM8P2XQ7", 0, version)).rejects.toThrow(
      DataIntegrityError,
    );
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it("returns null without writing when the invitation does not exist", async () => {
    firestoreMocks.transactionGet.mockResolvedValueOnce({ exists: false });
    await expect(restoreInvitationReplacement("missing", 0, version)).resolves.toBeNull();
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
});

describe("archive and restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.document.mockReturnValue({ get: firestoreMocks.getDocument });
    firestoreMocks.runTransaction.mockImplementation(async (callback) =>
      callback({
        get: firestoreMocks.transactionGet,
        update: firestoreMocks.transactionUpdate,
      }),
    );
  });

  function archiveSnapshot(
    isArchived: boolean | undefined,
    archivedAt: Timestamp | null | undefined,
  ) {
    return {
      exists: true,
      id: "KM8P2XQ7", ref: { path: "invitations/KM8P2XQ7" }, updateTime: new Timestamp(100, 123456000), data: () => ({
        ...validDocument(),
        ...(isArchived === undefined ? {} : { isArchived }),
        ...(archivedAt === undefined ? {} : { archivedAt }),
      }),
    };
  }

  it("archives an active legacy invitation and writes only archive fields", async () => {
    const archivedAt = Timestamp.fromDate(new Date("2026-08-29T12:00:00.000Z"));
    firestoreMocks.transactionGet.mockResolvedValueOnce(
      archiveSnapshot(undefined, undefined),
    );
    firestoreMocks.getDocument.mockResolvedValueOnce(archiveSnapshot(true, archivedAt));

    const result = await archiveInvitation("KM8P2XQ7");

    expect(firestoreMocks.transactionUpdate.mock.calls[0][1]).toEqual({
      isArchived: true,
      archivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    expect(result).toMatchObject({
      isArchived: true,
      archivedAt: new Date("2026-08-29T12:00:00.000Z"),
      maxGuests: 2,
      message: "Private message",
      rsvpStatus: "confirmed",
    });
  });

  it("returns an already archived invitation without writing or rereading", async () => {
    const archivedAt = Timestamp.fromDate(new Date("2026-08-29T12:00:00.000Z"));
    firestoreMocks.transactionGet.mockResolvedValueOnce(archiveSnapshot(true, archivedAt));
    await expect(archiveInvitation("KM8P2XQ7")).resolves.toMatchObject({
      isArchived: true,
    });
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });

  it("restores an archived invitation and writes only archive fields", async () => {
    const archivedAt = Timestamp.fromDate(new Date("2026-08-29T12:00:00.000Z"));
    firestoreMocks.transactionGet.mockResolvedValueOnce(archiveSnapshot(true, archivedAt));
    firestoreMocks.getDocument.mockResolvedValueOnce(archiveSnapshot(false, null));

    const result = await restoreArchivedInvitation("KM8P2XQ7");

    expect(firestoreMocks.transactionUpdate.mock.calls[0][1]).toEqual({
      isArchived: false,
      archivedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    expect(result).toMatchObject({
      isArchived: false,
      archivedAt: null,
      maxGuests: 2,
      message: "Private message",
      replacementsAllowed: true,
    });
  });

  it("returns an already active legacy invitation without writing or rereading", async () => {
    firestoreMocks.transactionGet.mockResolvedValueOnce(
      archiveSnapshot(undefined, undefined),
    );
    await expect(restoreArchivedInvitation("KM8P2XQ7")).resolves.toMatchObject({
      isArchived: false,
      archivedAt: null,
    });
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["archive", archiveInvitation],
    ["restore", restoreArchivedInvitation],
  ])("returns null when %s target does not exist", async (_name, operation) => {
    firestoreMocks.transactionGet.mockResolvedValueOnce({ exists: false });
    await expect(operation("missing")).resolves.toBeNull();
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
});


describe("removeInvitationGuest transaction", () => {
  const time = new Timestamp(100, 123456000);
  const snapshot = (data = validDocument(), updateTime = time, id = "KM8P2XQ7") => ({
    exists: true, id, ref: { path: "invitations/" + id }, updateTime, data: () => data,
  });
  const version = (snap = snapshot()) => mapInvitationSnapshot(snap as never).version;
  beforeEach(() => {
    vi.resetAllMocks();
    firestoreMocks.document.mockReturnValue({ get: firestoreMocks.getDocument });
    firestoreMocks.runTransaction.mockImplementation(async callback => callback({ get: firestoreMocks.transactionGet, update: firestoreMocks.transactionUpdate }));
    firestoreMocks.transactionGet.mockResolvedValue(snapshot());
    firestoreMocks.getDocument.mockResolvedValue(snapshot({ ...validDocument(), maxGuests: 1, guests: validDocument().guests.slice(0, 1) }, new Timestamp(101, 0)));
  });
  it("preserves raw guest fields and archived state, writes only three fields, returns reread version", async () => {
    const remaining = { ...validDocument().guests[0], historical: { nested: [1, 2] }, originalName: "Legacy" };
    const data = { ...validDocument(), isArchived: true, archivedAt: time, guests: [remaining, validDocument().guests[1]] };
    firestoreMocks.transactionGet.mockResolvedValue(snapshot(data));
    const finalSnapshot = snapshot({ ...data, maxGuests: 1, guests: [remaining] }, new Timestamp(102, 0));
    firestoreMocks.getDocument.mockResolvedValue(finalSnapshot);
    const result = await removeInvitationGuest("KM8P2XQ7", 1, version());
    const write = firestoreMocks.transactionUpdate.mock.calls[0][1];
    expect(write).toEqual({ guests: [remaining], maxGuests: 1, updatedAt: FieldValue.serverTimestamp() });
    expect(write.guests[0]).toBe(remaining);
    expect(write).not.toHaveProperty("version");
    expect(result).toMatchObject({ isArchived: true, rsvpStatus: "confirmed", replacementsAllowed: true, version: version(finalSnapshot) });
    expect(result?.version).not.toBe(version());
  });
  it("returns null for missing invitation", async () => {
    firestoreMocks.transactionGet.mockResolvedValue({ exists: false });
    expect(await removeInvitationGuest("missing", 0, version())).toBeNull();
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it.each([
    ["invalid document", { ...validDocument(), maxGuests: 3 }, 0, /guests length/],
    ["out of range", validDocument(), 2, /fuera de rango/],
    ["replacement", { ...validDocument(), guests: [{ name: "Other", shortName: "Other", type: "replacement", attending: true, originalName: "Original" }, validDocument().guests[1]] }, 0, /No se pueden eliminar invitados de reemplazo/],
    ["last guest", { ...validDocument(), maxGuests: 1, guests: validDocument().guests.slice(0, 1) }, 0, /entero mayor que cero/],
  ])("rejects %s without writing", async (_name, data, index, message) => {
    firestoreMocks.transactionGet.mockResolvedValue(snapshot(data as ReturnType<typeof validDocument>));
    await expect(removeInvitationGuest("KM8P2XQ7", index as number, version())).rejects.toThrow(message as RegExp);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });
  it.each(["old", "other invitation"])("rejects %s version before interpreting displaced index", async reason => {
    const expected = reason === "old" ? version(snapshot(validDocument(), new Timestamp(99, 0))) : version(snapshot(validDocument(), time, "OTHER"));
    await expect(removeInvitationGuest("KM8P2XQ7", 999, expected)).rejects.toMatchObject({ statusCode: 412, code: "PRECONDITION_FAILED" });
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it("rechecks the original version on transaction retry and does not commit a shifted deletion", async () => {
    let committed = false;
    const update = vi.fn();
    firestoreMocks.runTransaction.mockImplementation(async callback => {
      await callback({ get: async () => snapshot(), update }); // first attempt aborted by contention
      update.mockClear();
      const latest = { ...validDocument(), maxGuests: 1, guests: validDocument().guests.slice(1) };
      await callback({ get: async () => snapshot(latest, new Timestamp(101, 0)), update });
      committed = true;
    });
    await expect(removeInvitationGuest("KM8P2XQ7", 0, version())).rejects.toMatchObject({ statusCode: 412 });
    expect(update).not.toHaveBeenCalled();
    expect(committed).toBe(false);
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });
  it("propagates commit failure without rereading or confirming changes", async () => {
    firestoreMocks.runTransaction.mockImplementation(async callback => {
      await callback({ get: async () => snapshot(), update: vi.fn() });
      throw new Error("commit failed");
    });
    await expect(removeInvitationGuest("KM8P2XQ7", 0, version())).rejects.toThrow("commit failed");
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });
  it("does not retry a committed removal when rereading fails", async () => {
    firestoreMocks.getDocument.mockRejectedValue(new Error("read failed"));
    await expect(removeInvitationGuest("KM8P2XQ7", 0, version())).rejects.toThrow("read failed");
    expect(firestoreMocks.runTransaction).toHaveBeenCalledOnce();
    expect(firestoreMocks.transactionUpdate).toHaveBeenCalledOnce();
  });
  it("rejects missing updateTime rather than using updatedAt", async () => {
    firestoreMocks.transactionGet.mockResolvedValue({ ...snapshot(), updateTime: undefined });
    await expect(removeInvitationGuest("KM8P2XQ7", 0, version())).rejects.toThrow(DataIntegrityError);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it("returns versions for individual reads and each list item", async () => {
    const first = snapshot(); const second = snapshot(validDocument(), new Timestamp(102, 0), "OTHER");
    firestoreMocks.getDocument.mockResolvedValue(first);
    firestoreMocks.listDocuments.mockResolvedValue({ docs: [first, second] });
    expect((await getInvitationById(first.id))?.version).toBe(version(first));
    expect((await listInvitations()).map(item => item.version)).toEqual([version(first), version(second)]);
  });
  it.each([
    ["capacity", () => changeCapacity("KM8P2XQ7", 2)],
    ["restore active", () => restoreArchivedInvitation("KM8P2XQ7")],
  ])("returns original snapshot version for no-op %s", async (_name, operation) => {
    expect((await operation())?.version).toBe(version());
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
});


describe("versioned write responses", () => {
  const stamp = new Timestamp(200, 765432000);
  const data = validDocument();
  const snap = (overrides = {}) => ({ exists: true, id: "KM8P2XQ7", ref: { path: "invitations/KM8P2XQ7" }, updateTime: stamp, data: () => ({ ...data, ...overrides }) });
  beforeEach(() => {
    vi.resetAllMocks();
    firestoreMocks.document.mockReturnValue({ get: firestoreMocks.getDocument, create: firestoreMocks.createDocument, update: firestoreMocks.updateDocument });
    firestoreMocks.getDocument.mockResolvedValue(snap());
    firestoreMocks.transactionGet.mockResolvedValue(snap());
    firestoreMocks.runTransaction.mockImplementation(async callback => callback({ get: firestoreMocks.transactionGet, update: firestoreMocks.transactionUpdate }));
    idMocks.generateInvitationId.mockReturnValue("KM8P2XQ7");
  });
  it.each(["create", "update", "capacity", "replacement", "archive", "restore", "archive no-op"])("%s returns snapshot version without persisting it", async operation => {
    let result;
    if (operation === "create") {
      firestoreMocks.getDocument.mockResolvedValueOnce({ exists: false });
      result = await createInvitation({ displayName: "Family", knownGuests: [{ name: "Edgar" }], openSlots: 0, replacementsAllowed: true });
    } else if (operation === "update") result = await updateInvitation("KM8P2XQ7", { displayName: "New" });
    else if (operation === "capacity") result = await changeCapacity("KM8P2XQ7", 3);
    else if (operation === "replacement") {
      firestoreMocks.transactionGet.mockResolvedValue(snap({ guests: [{ name: "Other", shortName: "Other", type: "replacement", attending: true, originalName: "Julia" }, data.guests[1]] }));
      result = await restoreInvitationReplacement("KM8P2XQ7", 0, invitationVersion("invitations/KM8P2XQ7", stamp));
    } else if (operation === "restore") {
      firestoreMocks.transactionGet.mockResolvedValue(snap({ isArchived: true, archivedAt: stamp }));
      result = await restoreArchivedInvitation("KM8P2XQ7");
    } else {
      if (operation === "archive no-op") firestoreMocks.transactionGet.mockResolvedValue(snap({ isArchived: true, archivedAt: stamp }));
      result = await archiveInvitation("KM8P2XQ7");
    }
    expect(result?.version).toBe(mapInvitationSnapshot(snap() as never).version);
    for (const [write] of firestoreMocks.createDocument.mock.calls) expect(write).not.toHaveProperty("version");
    for (const [write] of firestoreMocks.updateDocument.mock.calls) expect(write).not.toHaveProperty("version");
    for (const [, write] of firestoreMocks.transactionUpdate.mock.calls) expect(write).not.toHaveProperty("version");
    if (operation === "archive no-op") {
      expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
      expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
    }
  });
});

describe("updateInvitationGuest transaction", () => {
  const time = new Timestamp(100, 123456000);
  const snapshot = (data = validDocument(), updateTime = time, id = "KM8P2XQ7") => ({
    exists: true, id, ref: { path: "invitations/" + id }, updateTime, data: () => data,
  });
  const version = (snap = snapshot()) => mapInvitationSnapshot(snap as never).version;
  beforeEach(() => {
    vi.resetAllMocks();
    firestoreMocks.document.mockReturnValue({ get: firestoreMocks.getDocument });
    firestoreMocks.runTransaction.mockImplementation(async callback => callback({ get: firestoreMocks.transactionGet, update: firestoreMocks.transactionUpdate }));
    firestoreMocks.transactionGet.mockResolvedValue(snapshot());
    firestoreMocks.getDocument.mockResolvedValue(snapshot(validDocument(), new Timestamp(101, 0)));
  });
  it.each(["known", "open", "replacement"].flatMap(type => [true, false, null].flatMap(attending => ["pending", "partial", "confirmed", "declined"].map(rsvpStatus => ({ type, attending, rsvpStatus })))))("preserves all state for %j", async ({ type, attending, rsvpStatus }) => {
    const edited = { name: "Carlos Martínez", shortName: "Carlos", type, attending, originalName: "Cassandra Us Hernandez", legacyField: { nested: [1, 2] } };
    const other = { ...validDocument().guests[1], legacyOther: "conservar" };
    const data = { ...validDocument(), rsvpStatus, isArchived: true, archivedAt: time, editOverrideUntil: time, legacyInvitation: true, guests: [edited, other] };
    firestoreMocks.transactionGet.mockResolvedValue(snapshot(data as never));
    const updatedGuest = { ...edited, name: "José Carlos Martínez", shortName: "José" };
    const finalSnapshot = snapshot({ ...data, guests: [updatedGuest, other] } as never, new Timestamp(102, 0));
    firestoreMocks.getDocument.mockResolvedValue(finalSnapshot);
    const result = await updateInvitationGuest("KM8P2XQ7", 0, "  José   Carlos Martínez  ", version());
    const write = firestoreMocks.transactionUpdate.mock.calls[0][1];
    expect(write).toEqual({ guests: [updatedGuest, other], updatedAt: FieldValue.serverTimestamp() });
    expect(write.guests[1]).toBe(other);
    expect(edited.name).toBe("Carlos Martínez");
    expect(result).toEqual(mapInvitationSnapshot(finalSnapshot as never));
    expect(result?.version).not.toBe(version());
  });
  it("corrects replacement spelling and preserves originalName", async () => {
    const guest = { name: "Mariana Prueva", shortName: "Mariana", type: "replacement", attending: true, originalName: "Cassandra Us Hernandez" };
    firestoreMocks.transactionGet.mockResolvedValue(snapshot({ ...validDocument(), guests: [guest, validDocument().guests[1]] }));
    await updateInvitationGuest("KM8P2XQ7", 0, "Mariana Prueba", version());
    expect(firestoreMocks.transactionUpdate.mock.calls[0][1]).toEqual({ guests: [{ ...guest, name: "Mariana Prueba" }, validDocument().guests[1]], updatedAt: FieldValue.serverTimestamp() });
  });
  it.each(["", "   "])("rejects empty target name %j without writing", async name => {
    await expect(updateInvitationGuest("KM8P2XQ7", 0, name, version())).rejects.toThrow(DomainError);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it("returns null for missing invitation", async () => {
    firestoreMocks.transactionGet.mockResolvedValue({ exists: false });
    expect(await updateInvitationGuest("missing", 0, "José Carlos Martínez", version())).toBeNull();
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it.each([
    ["invalid document", { ...validDocument(), maxGuests: 3 }, 0, /guests length/],
    ["out of range", validDocument(), 2, /fuera de rango/],
    ["empty open", { ...validDocument(), guests: [{ name: "  ", shortName: "Acompañante", type: "open", attending: null }, validDocument().guests[1]] }, 0, /no tiene una persona asignada/],
  ])("rejects %s without writing", async (_name, data, index, message) => {
    firestoreMocks.transactionGet.mockResolvedValue(snapshot(data as ReturnType<typeof validDocument>));
    await expect(updateInvitationGuest("KM8P2XQ7", index as number, "José Carlos Martínez", version())).rejects.toThrow(message as RegExp);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });
  it.each(["old", "other invitation"])("rejects %s version before interpreting displaced index", async reason => {
    const expected = reason === "old" ? version(snapshot(validDocument(), new Timestamp(99, 0))) : version(snapshot(validDocument(), time, "OTHER"));
    await expect(updateInvitationGuest("KM8P2XQ7", 999, "José Carlos Martínez", expected)).rejects.toMatchObject({ statusCode: 412, code: "PRECONDITION_FAILED" });
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it("rechecks the original version on transaction retry and does not commit a shifted edit", async () => {
    let committed = false;
    const update = vi.fn();
    firestoreMocks.runTransaction.mockImplementation(async callback => {
      await callback({ get: async () => snapshot(), update }); // first attempt aborted by contention
      update.mockClear();
      const latest = { ...validDocument(), maxGuests: 1, guests: validDocument().guests.slice(1) };
      await callback({ get: async () => snapshot(latest, new Timestamp(101, 0)), update });
      committed = true;
    });
    await expect(updateInvitationGuest("KM8P2XQ7", 0, "José Carlos Martínez", version())).rejects.toMatchObject({ statusCode: 412 });
    expect(update).not.toHaveBeenCalled();
    expect(committed).toBe(false);
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });
  it("propagates commit failure without rereading or confirming changes", async () => {
    firestoreMocks.runTransaction.mockImplementation(async callback => {
      await callback({ get: async () => snapshot(), update: vi.fn() });
      throw new Error("commit failed");
    });
    await expect(updateInvitationGuest("KM8P2XQ7", 0, "José Carlos Martínez", version())).rejects.toThrow("commit failed");
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
    expect(firestoreMocks.runTransaction).toHaveBeenCalledOnce();
  });
  it("does not retry a committed edit when rereading fails", async () => {
    firestoreMocks.getDocument.mockRejectedValue(new Error("read failed"));
    await expect(updateInvitationGuest("KM8P2XQ7", 0, "José Carlos Martínez", version())).rejects.toThrow("read failed");
    expect(firestoreMocks.runTransaction).toHaveBeenCalledOnce();
    expect(firestoreMocks.transactionUpdate).toHaveBeenCalledOnce();
  });
  it("does not retry when the committed document disappears before rereading", async () => {
    firestoreMocks.getDocument.mockResolvedValue({ exists: false });
    await expect(updateInvitationGuest("KM8P2XQ7", 0, "Ana", version())).rejects.toThrow("Updated invitation could not be read back");
    expect(firestoreMocks.runTransaction).toHaveBeenCalledOnce();
    expect(firestoreMocks.transactionUpdate).toHaveBeenCalledOnce();
  });
  it.each(["known", "open", "replacement"])("rejects an unnamed %s without writing", async type => {
    firestoreMocks.transactionGet.mockResolvedValue(snapshot({ ...validDocument(), guests: [{ name: "", shortName: "Guest", type, attending: null, originalName: "Original" }, validDocument().guests[1]] } as never));
    await expect(updateInvitationGuest("KM8P2XQ7", 0, "Ana", version())).rejects.toThrow(DomainError);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it("rejects missing updateTime rather than using updatedAt", async () => {
    firestoreMocks.transactionGet.mockResolvedValue({ ...snapshot(), updateTime: undefined });
    await expect(updateInvitationGuest("KM8P2XQ7", 0, "José Carlos Martínez", version())).rejects.toThrow(DataIntegrityError);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
});


describe("editOverrideUntil legacy mapping", () => {
  it("maps missing and explicit undefined to null", () => {
    const { editOverrideUntil: _ignored, ...legacy } = validDocument();
    expect(mapInvitationDocument("legacy", legacy).editOverrideUntil).toBeNull();
    expect(mapInvitationDocument("legacy", { ...legacy, editOverrideUntil: undefined }).editOverrideUntil).toBeNull();
  });
  it("maps null and Timestamp without relaxing other fields", () => {
    const stamp = new Timestamp(200, 123000000);
    expect(mapInvitationDocument("legacy", validDocument()).editOverrideUntil).toBeNull();
    expect(mapInvitationDocument("legacy", { ...validDocument(), editOverrideUntil: stamp }).editOverrideUntil).toEqual(stamp.toDate());
    expect(() => mapInvitationDocument("legacy", { ...validDocument(), updatedAt: undefined })).toThrow(DataIntegrityError);
  });
  it.each(["tomorrow", 123, {}, [], false, new Date(0)])("rejects present invalid override %j", editOverrideUntil => {
    expect(() => mapInvitationDocument("legacy", { ...validDocument(), editOverrideUntil })).toThrow(DataIntegrityError);
  });
});

describe("updateInvitation extraordinary permission transaction", () => {
  const id = "test-override";
  const now = Date.parse("2028-03-15T03:00:00.000Z");
  const future = new Date(now + 86400000);
  const time = new Timestamp(100, 123456000);
  const snapshot = (data: Record<string, unknown> = validDocument(), updateTime = time, documentId = id) => ({
    exists: true, id: documentId, ref: { path: "invitations/" + documentId }, updateTime, data: () => data,
  });
  const version = invitationVersion("invitations/" + id, time);
  const transaction = { get: firestoreMocks.transactionGet, update: firestoreMocks.transactionUpdate };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now);
    firestoreMocks.document.mockReturnValue({ get: firestoreMocks.getDocument, update: firestoreMocks.updateDocument });
    firestoreMocks.transactionGet.mockResolvedValue(snapshot());
    firestoreMocks.getDocument.mockResolvedValue(snapshot({ ...validDocument(), editOverrideUntil: Timestamp.fromDate(future) }, new Timestamp(101, 0)));
    firestoreMocks.runTransaction.mockImplementation(async callback => callback(transaction));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["pending", "partial", "confirmed", "declined"])("grants permission and preserves raw data for %s", async rsvpStatus => {
    const original = { ...validDocument(), rsvpStatus, isArchived: false, archivedAt: null,
      historical: { nested: [1, 2] }, guests: validDocument().guests.map(g => ({ ...g, originalName: "Legacy", unknown: 42 })) };
    const originalCopy = structuredClone(original);
    firestoreMocks.transactionGet.mockResolvedValue(snapshot(original));
    const finalSnapshot = snapshot({ ...original, editOverrideUntil: Timestamp.fromDate(future), updatedAt: new Timestamp(101, 0) }, new Timestamp(101, 0));
    firestoreMocks.getDocument.mockResolvedValue(finalSnapshot);
    const result = await updateInvitation(id, { editOverrideUntil: future }, version);
    expect(firestoreMocks.transactionUpdate).toHaveBeenCalledExactlyOnceWith(firestoreMocks.document.mock.results[0].value, {
      editOverrideUntil: Timestamp.fromDate(future), updatedAt: FieldValue.serverTimestamp(),
    });
    expect(original).toEqual(originalCopy);
    expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    expect(result).toEqual(mapInvitationSnapshot(finalSnapshot as never));
    expect(result?.version).not.toBe(version);
  });
  it.each([true, false])("revokes with null even when archived=%s", async isArchived => {
    const data = { ...validDocument(), editOverrideUntil: Timestamp.fromDate(future), isArchived, archivedAt: isArchived ? time : null };
    firestoreMocks.transactionGet.mockResolvedValue(snapshot(data));
    const finalSnapshot = snapshot({ ...data, editOverrideUntil: null }, new Timestamp(101, 0));
    firestoreMocks.getDocument.mockResolvedValue(finalSnapshot);
    expect(await updateInvitation(id, { editOverrideUntil: null }, version)).toEqual(mapInvitationSnapshot(finalSnapshot as never));
    expect(firestoreMocks.transactionUpdate.mock.calls[0][1]).toEqual({ editOverrideUntil: null, updatedAt: FieldValue.serverTimestamp() });
  });
  it.each([null, new Timestamp(50, 0), Timestamp.fromDate(new Date(now + 1000)), Timestamp.fromDate(new Date(now + 172800000))])("sets, extends or shortens an existing permission %j", async old => {
    firestoreMocks.transactionGet.mockResolvedValue(snapshot({ ...validDocument(), editOverrideUntil: old }));
    await updateInvitation(id, { editOverrideUntil: future }, version);
    expect(firestoreMocks.transactionUpdate.mock.calls[0][1].editOverrideUntil).toEqual(Timestamp.fromDate(future));
  });
  it("grants on a legacy document without override", async () => {
    const { editOverrideUntil: _ignored, ...legacy } = validDocument();
    firestoreMocks.transactionGet.mockResolvedValue(snapshot(legacy));
    await updateInvitation(id, { editOverrideUntil: future }, version);
    expect(firestoreMocks.transactionUpdate).toHaveBeenCalledOnce();
  });
  it.each([-1, 0])("rejects past/equal server time (%i ms) without any write", async delta => {
    await expect(updateInvitation(id, { editOverrideUntil: new Date(now + delta) }, version)).rejects.toThrow(/debe ser futura/);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });
  it("rejects granting on an archived snapshot", async () => {
    firestoreMocks.transactionGet.mockResolvedValue(snapshot({ ...validDocument(), isArchived: true, archivedAt: time }));
    await expect(updateInvitation(id, { editOverrideUntil: future }, version)).rejects.toThrow(/Restaura/);
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it.each([future, null])("requires a valid version even for service callers (%j)", async editOverrideUntil => {
    for (const invalid of [undefined, "bad"]) {
      await expect(updateInvitation(id, { editOverrideUntil }, invalid)).rejects.toThrow(DomainError);
    }
    expect(firestoreMocks.runTransaction).not.toHaveBeenCalled();
    expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
  });
  it.each(["stale", "other invitation", "archived", "RSVP", "past date"])("checks version first: %s", async reason => {
    const data = { ...validDocument(), isArchived: reason === "archived", archivedAt: reason === "archived" ? time : null,
      ...(reason === "RSVP" ? { guests: validDocument().guests.map(g => ({ ...g, attending: false })), rsvpStatus: "declined", message: "Changed RSVP" } : {}) };
    firestoreMocks.transactionGet.mockResolvedValue(snapshot(data, new Timestamp(102, 0)));
    const expected = reason === "other invitation" ? invitationVersion("invitations/OTHER", time) : version;
    await expect(updateInvitation(id, { displayName: "Updated", replacementsAllowed: false, editOverrideUntil: reason === "past date" ? new Date(now) : future }, expected)).rejects.toMatchObject({ statusCode: 412, code: "PRECONDITION_FAILED" });
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });
  it("writes a combined body atomically and returns reread version", async () => {
    const input = { displayName: "Updated family", replacementsAllowed: false, editOverrideUntil: future };
    const finalSnapshot = snapshot({ ...validDocument(), ...input, editOverrideUntil: Timestamp.fromDate(future) }, new Timestamp(102, 0));
    firestoreMocks.getDocument.mockResolvedValue(finalSnapshot);
    const result = await updateInvitation(id, input, version);
    expect(firestoreMocks.transactionUpdate.mock.calls).toHaveLength(1);
    expect(firestoreMocks.transactionUpdate.mock.calls[0][1]).toEqual({ ...input, editOverrideUntil: Timestamp.fromDate(future), updatedAt: FieldValue.serverTimestamp() });
    expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    expect(result).toEqual(mapInvitationSnapshot(finalSnapshot as never));
  });
  it.each(["version", "time"])("rechecks %s on retry without committing the second attempt", async reason => {
    let committed = false;
    const update = vi.fn();
    firestoreMocks.runTransaction.mockImplementation(async callback => {
      await callback({ get: async () => snapshot(), update });
      update.mockClear(); // contention aborted the first attempt
      if (reason === "time") vi.mocked(Date.now).mockReturnValue(future.getTime());
      await callback({ get: async () => snapshot(validDocument(), reason === "version" ? new Timestamp(101, 0) : time), update });
      committed = true;
    });
    const result = updateInvitation(id, { editOverrideUntil: future }, version);
    if (reason === "version") await expect(result).rejects.toMatchObject({ statusCode: 412 });
    else await expect(result).rejects.toThrow(/debe ser futura/);
    expect(committed).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
    expect(firestoreMocks.runTransaction).toHaveBeenCalledOnce();
  });
  it("returns null for a missing invitation without writing", async () => {
    firestoreMocks.transactionGet.mockResolvedValue({ exists: false });
    expect(await updateInvitation(id, { editOverrideUntil: future }, version)).toBeNull();
    expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
  });
  it.each(["read", "commit", "reread", "missing reread"])("does not retry after infrastructure failure: %s", async failure => {
    if (failure === "read") firestoreMocks.transactionGet.mockRejectedValue(new Error("failed"));
    if (failure === "commit") firestoreMocks.runTransaction.mockImplementation(async callback => { await callback(transaction); throw new Error("failed"); });
    if (failure === "reread") firestoreMocks.getDocument.mockRejectedValue(new Error("failed"));
    if (failure === "missing reread") firestoreMocks.getDocument.mockResolvedValue({ exists: false });
    await expect(updateInvitation(id, { editOverrideUntil: future }, version)).rejects.toThrow();
    expect(firestoreMocks.runTransaction).toHaveBeenCalledOnce();
    expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    if (failure === "read") expect(firestoreMocks.transactionUpdate).not.toHaveBeenCalled();
    else expect(firestoreMocks.transactionUpdate).toHaveBeenCalledOnce();
    if (failure === "read" || failure === "commit") expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
    else expect(firestoreMocks.getDocument).toHaveBeenCalledOnce();
  });
});
