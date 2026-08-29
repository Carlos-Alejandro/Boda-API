import type { Request, Response } from "express";

import {
  archiveInvitation,
  changeCapacity,
  createInvitation,
  getInvitationById,
  listInvitations,
  restoreInvitationReplacement,
  restoreArchivedInvitation,
  updateInvitation,
} from "../services/invitations.service";
import { HttpError } from "../errors/HttpError";
import type { Invitation } from "../types/invitation";
import { parseCreateInvitationInput } from "../validation/createInvitationInput";
import { parseUpdateInvitationInput } from "../validation/updateInvitationInput";
import { parseChangeInvitationCapacityInput } from "../validation/changeInvitationCapacityInput";
import { parseGuestIndex } from "../validation/guestIndex";
import { parseListInvitationsQuery } from "../validation/listInvitationsQuery";

function toHttpInvitation(invitation: Invitation) {
  return {
    ...invitation,
    archivedAt: invitation.archivedAt?.toISOString() ?? null,
    updatedAt: invitation.updatedAt?.toISOString() ?? null,
    editOverrideUntil: invitation.editOverrideUntil?.toISOString() ?? null,
  };
}

function invitationNotFound(): never {
  throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation not found");
}

export async function listInvitationsController(
  request: Request,
  response: Response,
): Promise<void> {
  const filters = parseListInvitationsQuery(request.query);
  const invitations = await listInvitations(filters);
  response.status(200).json({
    items: invitations.map(toHttpInvitation),
    total: invitations.length,
  });
}

export async function getInvitationController(
  request: Request<{ id: string }>,
  response: Response,
): Promise<void> {
  const invitation = await getInvitationById(request.params.id);
  if (!invitation) invitationNotFound();
  response.status(200).json(toHttpInvitation(invitation));
}

export async function createInvitationController(
  request: Request,
  response: Response,
): Promise<void> {
  const input = parseCreateInvitationInput(request.body);
  const invitation = await createInvitation(input);
  response.status(201).json(toHttpInvitation(invitation));
}

export async function updateInvitationController(
  request: Request<{ id: string }>,
  response: Response,
): Promise<void> {
  const input = parseUpdateInvitationInput(request.body);
  const invitation = await updateInvitation(request.params.id, input);
  if (!invitation) invitationNotFound();
  response.status(200).json(toHttpInvitation(invitation));
}

export async function changeInvitationCapacityController(
  request: Request<{ id: string }>,
  response: Response,
): Promise<void> {
  const { maxGuests } = parseChangeInvitationCapacityInput(request.body);
  const invitation = await changeCapacity(request.params.id, maxGuests);
  if (!invitation) invitationNotFound();
  response.status(200).json(toHttpInvitation(invitation));
}

export async function restoreInvitationReplacementController(
  request: Request<{ id: string; guestIndex: string }>,
  response: Response,
): Promise<void> {
  const guestIndex = parseGuestIndex(request.params.guestIndex);
  const invitation = await restoreInvitationReplacement(
    request.params.id,
    guestIndex,
  );
  if (!invitation) invitationNotFound();
  response.status(200).json(toHttpInvitation(invitation));
}

async function respondWithArchiveState(
  invitationPromise: Promise<Invitation | null>,
  response: Response,
): Promise<void> {
  const invitation = await invitationPromise;
  if (!invitation) invitationNotFound();
  response.status(200).json(toHttpInvitation(invitation));
}

export async function archiveInvitationController(
  request: Request<{ id: string }>,
  response: Response,
): Promise<void> {
  await respondWithArchiveState(archiveInvitation(request.params.id), response);
}

export async function restoreArchivedInvitationController(
  request: Request<{ id: string }>,
  response: Response,
): Promise<void> {
  await respondWithArchiveState(
    restoreArchivedInvitation(request.params.id),
    response,
  );
}
