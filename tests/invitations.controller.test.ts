import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  getInvitationById: vi.fn(),
  listInvitations: vi.fn(),
}));

vi.mock("../src/services/invitations.service", () => serviceMocks);

import {
  getInvitationController,
  listInvitationsController,
} from "../src/controllers/invitations.controller";

function responseMock() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
}

describe("invitations controllers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the invitation does not exist", async () => {
    serviceMocks.getInvitationById.mockResolvedValue(null);
    const response = responseMock();

    await getInvitationController(
      { params: { id: "missing" } } as Request<{ id: string }>,
      response,
      vi.fn() as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ error: "Invitation not found" });
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
      {} as Request,
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
  });
});
