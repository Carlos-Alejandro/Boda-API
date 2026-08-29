import type { NextFunction, Request, Response } from "express";

import {
  changeCapacity,
  createInvitation,
  getInvitationById,
  listInvitations,
  updateInvitation,
} from "../services/invitations.service";
import { DomainError } from "../errors/DomainError";
import type { Invitation } from "../types/invitation";
import { parseCreateInvitationInput } from "../validation/createInvitationInput";
import { parseUpdateInvitationInput } from "../validation/updateInvitationInput";
import { parseChangeInvitationCapacityInput } from "../validation/changeInvitationCapacityInput";

function toHttpInvitation(invitation: Invitation) {
  return {
    ...invitation,
    updatedAt: invitation.updatedAt?.toISOString() ?? null,
    editOverrideUntil: invitation.editOverrideUntil?.toISOString() ?? null,
  };
}

export async function listInvitationsController(
  _request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invitations = await listInvitations();
    response.status(200).json({
      items: invitations.map(toHttpInvitation),
      total: invitations.length,
    });
  } catch (error) {
    next(error);
  }
}

export async function getInvitationController(
  request: Request<{ id: string }>,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invitation = await getInvitationById(request.params.id);
    if (!invitation) {
      response.status(404).json({ error: "Invitation not found" });
      return;
    }

    response.status(200).json(toHttpInvitation(invitation));
  } catch (error) {
    next(error);
  }
}

export async function createInvitationController(
  request: Request,
  response: Response,
): Promise<void> {
  try {
    const input = parseCreateInvitationInput(request.body);
    const invitation = await createInvitation(input);
    response.status(201).json(toHttpInvitation(invitation));
  } catch (error) {
    if (error instanceof DomainError) {
      response.status(400).json({ error: error.message });
      return;
    }
    response.status(500).json({ error: "Internal server error" });
  }
}

export async function updateInvitationController(
  request: Request<{ id: string }>,
  response: Response,
): Promise<void> {
  try {
    const input = parseUpdateInvitationInput(request.body);
    const invitation = await updateInvitation(request.params.id, input);
    if (!invitation) {
      response.status(404).json({ error: "Invitation not found" });
      return;
    }
    response.status(200).json(toHttpInvitation(invitation));
  } catch (error) {
    if (error instanceof DomainError) {
      response.status(400).json({ error: error.message });
      return;
    }
    response.status(500).json({ error: "Internal server error" });
  }
}

export async function changeInvitationCapacityController(
  request: Request<{ id: string }>,
  response: Response,
): Promise<void> {
  try {
    const { maxGuests } = parseChangeInvitationCapacityInput(request.body);
    const invitation = await changeCapacity(request.params.id, maxGuests);
    if (!invitation) {
      response.status(404).json({ error: "Invitation not found" });
      return;
    }
    response.status(200).json(toHttpInvitation(invitation));
  } catch (error) {
    if (error instanceof DomainError) {
      response.status(400).json({ error: error.message });
      return;
    }
    response.status(500).json({ error: "Internal server error" });
  }
}
