import { Timestamp } from "firebase-admin/firestore";
import { invitationVersion } from "../src/services/invitationVersion.service";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  archiveInvitation: vi.fn(),
  changeCapacity: vi.fn(),
  createInvitation: vi.fn(),
  getInvitationById: vi.fn(),
  listInvitations: vi.fn(),
  restoreInvitationReplacement: vi.fn(),
  restoreArchivedInvitation: vi.fn(),
  updateInvitation: vi.fn(),
}));

vi.mock("../src/services/invitations.service", () => serviceMocks);

import {
  archiveInvitationController,
  changeInvitationCapacityController,
  createInvitationController,
  getInvitationController,
  listInvitationsController,
  restoreInvitationReplacementController,
  restoreArchivedInvitationController,
  updateInvitationController,
} from "../src/controllers/invitations.controller";
import { errorHandler } from "../src/middlewares/errorHandler";

const restoreVersion = invitationVersion("invitations/KM8P2XQ7", new Timestamp(100, 123456000));

function responseMock() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
}

async function withErrorHandler(
  operation: Promise<void>,
  response: Response,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    errorHandler(error, {} as Request, response, vi.fn());
  }
}

describe("invitations controllers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the invitation does not exist", async () => {
    serviceMocks.getInvitationById.mockResolvedValue(null);
    const response = responseMock();

    await withErrorHandler(
      getInvitationController(
        { params: { id: "missing" } } as Request<{ id: string }>,
        response,
      ),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "INVITATION_NOT_FOUND", message: "Invitación no encontrada" },
    });
  });

  it("returns a list with ids and ISO dates", async () => {
    serviceMocks.listInvitations.mockResolvedValue([
      {
        id: "KM8P2XQ7",
        displayName: "Julia & Jordi",
        maxGuests: 1,
        replacementsAllowed: false,
        rsvpStatus: "pending",
        message: "",
        updatedAt: new Date("2026-08-01T10:00:00.000Z"),
        editOverrideUntil: null,
        guests: [{ name: "Julia", shortName: "Julia", type: "known", attending: null }],
      },
    ]);
    const response = responseMock();

    await listInvitationsController(
      { query: {} } as Request,
      response,
      vi.fn() as NextFunction,
    );

    expect(response.json).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          id: "KM8P2XQ7",
          updatedAt: "2026-08-01T10:00:00.000Z",
          editOverrideUntil: null,
        }),
      ],
      total: 1,
    });
    expect(serviceMocks.listInvitations).toHaveBeenCalledWith({});
  });

  it("parses and forwards list filters without changing the response format", async () => {
    serviceMocks.listInvitations.mockResolvedValue([]);
    const response = responseMock();

    await listInvitationsController(
      {
        query: {
          search: "  Julia  ",
          rsvpStatus: "confirmed",
          archived: "false",
        },
      } as unknown as Request,
      response,
      vi.fn() as NextFunction,
    );

    expect(serviceMocks.listInvitations).toHaveBeenCalledWith({
      search: "Julia",
      rsvpStatus: "confirmed",
      archived: false,
    });
    expect(response.json).toHaveBeenCalledWith({ items: [], total: 0 });
  });

  it("returns 400 for invalid or repeated list query parameters", async () => {
    const response = responseMock();

    await withErrorHandler(
      listInvitationsController(
        { query: { archived: ["true", "false"] } } as unknown as Request,
        response,
      ),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(serviceMocks.listInvitations).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid create body", async () => {
    const response = responseMock();
    await withErrorHandler(
      createInvitationController(
        { body: { displayName: "", knownGuests: [], openSlots: 0, replacementsAllowed: true } } as Request,
        response,
      ),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(serviceMocks.createInvitation).not.toHaveBeenCalled();
  });

  it("returns 201 for a valid creation", async () => {
    serviceMocks.createInvitation.mockResolvedValue({
      id: "AB2CD3EF",
      displayName: "Familia Pérez",
      maxGuests: 1,
      replacementsAllowed: true,
      rsvpStatus: "pending",
      message: "",
      updatedAt: new Date("2026-08-29T10:00:00.000Z"),
      editOverrideUntil: null,
      guests: [{ name: "Juan Pérez", shortName: "Juan", type: "known", attending: null }],
    });
    const response = responseMock();
    const body = {
      displayName: "Familia Pérez",
      knownGuests: [{ name: "Juan Pérez" }],
      openSlots: 0,
      replacementsAllowed: true,
    };

    await createInvitationController({ body } as Request, response);

    expect(serviceMocks.createInvitation).toHaveBeenCalledWith(body);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ id: "AB2CD3EF", updatedAt: "2026-08-29T10:00:00.000Z" }),
    );
  });

  it("returns 404 when updating a missing invitation", async () => {
    serviceMocks.updateInvitation.mockResolvedValue(null);
    const response = responseMock();
    await withErrorHandler(
      updateInvitationController(
        { params: { id: "missing" }, body: { displayName: "Familia" } } as Request<{ id: string }>,
        response,
      ),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 for an invalid update body", async () => {
    const response = responseMock();
    await withErrorHandler(
      updateInvitationController(
        { params: { id: "KM8P2XQ7" }, body: { guests: [] } } as Request<{ id: string }>,
        response,
      ),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(serviceMocks.updateInvitation).not.toHaveBeenCalled();
  });

  it("returns 200 after a valid update", async () => {
    serviceMocks.updateInvitation.mockResolvedValue({
      id: "KM8P2XQ7",
      displayName: "Familia Actualizada",
      maxGuests: 2,
      replacementsAllowed: true,
      rsvpStatus: "confirmed",
      message: "",
      updatedAt: new Date("2026-08-29T12:00:00.000Z"),
      editOverrideUntil: null,
      guests: [],
    });
    const response = responseMock();
    await updateInvitationController(
      {
        params: { id: "KM8P2XQ7" },
        body: { displayName: "  Familia Actualizada  " },
      } as Request<{ id: string }>,
      response,
    );
    expect(serviceMocks.updateInvitation).toHaveBeenCalledWith("KM8P2XQ7", {
      displayName: "Familia Actualizada",
    });
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it("returns 400 for an invalid capacity body", async () => {
    const response = responseMock();
    await withErrorHandler(
      changeInvitationCapacityController(
        { params: { id: "KM8P2XQ7" }, body: { maxGuests: 2.5 } } as Request<{ id: string }>,
        response,
      ),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(serviceMocks.changeCapacity).not.toHaveBeenCalled();
  });

  it("returns 404 when changing capacity of a missing invitation", async () => {
    serviceMocks.changeCapacity.mockResolvedValue(null);
    const response = responseMock();
    await withErrorHandler(
      changeInvitationCapacityController(
        { params: { id: "missing" }, body: { maxGuests: 3 } } as Request<{ id: string }>,
        response,
      ),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 after changing capacity", async () => {
    serviceMocks.changeCapacity.mockResolvedValue({
      id: "KM8P2XQ7",
      displayName: "Julia & Jordi",
      maxGuests: 3,
      replacementsAllowed: true,
      rsvpStatus: "confirmed",
      message: "",
      updatedAt: new Date("2026-08-29T12:00:00.000Z"),
      editOverrideUntil: null,
      guests: [],
    });
    const response = responseMock();
    await changeInvitationCapacityController(
      { params: { id: "KM8P2XQ7" }, body: { maxGuests: 3 } } as Request<{ id: string }>,
      response,
    );
    expect(serviceMocks.changeCapacity).toHaveBeenCalledWith("KM8P2XQ7", 3);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it("returns 400 for an invalid replacement guestIndex", async () => {
    const response = responseMock();
    await withErrorHandler(
      restoreInvitationReplacementController(
        { params: { id: "KM8P2XQ7", guestIndex: "-1" } } as Request<{
          id: string;
          guestIndex: string;
        }>,
        response,
      ),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(serviceMocks.restoreInvitationReplacement).not.toHaveBeenCalled();
  });

  it("returns 404 when the invitation to restore does not exist", async () => {
    serviceMocks.restoreInvitationReplacement.mockResolvedValue(null);
    const response = responseMock();
    await withErrorHandler(
      restoreInvitationReplacementController(
        { params: { id: "missing", guestIndex: "0" }, headersDistinct: { "x-invitation-version": [restoreVersion] } } as Request<{
          id: string;
          guestIndex: string;
        }>,
        response,
      ),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 after restoring a replacement", async () => {
    serviceMocks.restoreInvitationReplacement.mockResolvedValue({
      id: "KM8P2XQ7",
      displayName: "Julia & Jordi",
      maxGuests: 1,
      replacementsAllowed: true,
      rsvpStatus: "confirmed",
      message: "",
      updatedAt: new Date("2026-08-29T12:00:00.000Z"),
      editOverrideUntil: null,
      guests: [],
    });
    const response = responseMock();
    await restoreInvitationReplacementController(
      { params: { id: "KM8P2XQ7", guestIndex: "0" }, headersDistinct: { "x-invitation-version": [restoreVersion] } } as Request<{
        id: string;
        guestIndex: string;
      }>,
      response,
    );
    expect(serviceMocks.restoreInvitationReplacement).toHaveBeenCalledWith(
      "KM8P2XQ7",
      0,
      restoreVersion,
    );
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it("returns 200 after archiving", async () => {
    serviceMocks.archiveInvitation.mockResolvedValue({
      id: "KM8P2XQ7",
      displayName: "Julia & Jordi",
      maxGuests: 1,
      replacementsAllowed: true,
      rsvpStatus: "confirmed",
      message: "",
      isArchived: true,
      archivedAt: new Date("2026-08-29T12:00:00.000Z"),
      updatedAt: new Date("2026-08-29T12:00:00.000Z"),
      editOverrideUntil: null,
      guests: [],
    });
    const response = responseMock();
    await archiveInvitationController(
      { params: { id: "KM8P2XQ7" } } as Request<{ id: string }>,
      response,
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        isArchived: true,
        archivedAt: "2026-08-29T12:00:00.000Z",
      }),
    );
  });

  it("returns 404 when archive target does not exist", async () => {
    serviceMocks.archiveInvitation.mockResolvedValue(null);
    const response = responseMock();
    await withErrorHandler(
      archiveInvitationController(
        { params: { id: "missing" } } as Request<{ id: string }>,
        response,
      ),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 after restoring an archived invitation", async () => {
    serviceMocks.restoreArchivedInvitation.mockResolvedValue({
      id: "KM8P2XQ7",
      displayName: "Julia & Jordi",
      maxGuests: 1,
      replacementsAllowed: true,
      rsvpStatus: "confirmed",
      message: "",
      isArchived: false,
      archivedAt: null,
      updatedAt: new Date("2026-08-29T12:00:00.000Z"),
      editOverrideUntil: null,
      guests: [],
    });
    const response = responseMock();
    await restoreArchivedInvitationController(
      { params: { id: "KM8P2XQ7" } } as Request<{ id: string }>,
      response,
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ isArchived: false, archivedAt: null }),
    );
  });

  it("returns 404 when restore target does not exist", async () => {
    serviceMocks.restoreArchivedInvitation.mockResolvedValue(null);
    const response = responseMock();
    await withErrorHandler(
      restoreArchivedInvitationController(
        { params: { id: "missing" } } as Request<{ id: string }>,
        response,
      ),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(404);
  });
});
