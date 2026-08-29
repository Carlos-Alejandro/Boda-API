import type { NextFunction, Request, Response } from "express";

import {
  getInvitationById,
  listInvitations,
} from "../services/invitations.service";
import type { Invitation } from "../types/invitation";

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
