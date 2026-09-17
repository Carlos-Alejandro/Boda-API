import type { Request, Response } from "express";

import {
  removeInvitationGuest,
  updateInvitationGuest,
  archiveInvitation,
  changeCapacity,
  createInvitation,
  createInvitationIdempotently,
  getInvitationById,
  listInvitations,
  restoreInvitationReplacement,
  restoreArchivedInvitation,
  updateInvitation,
} from "../services/invitations.service";
import { HttpError } from "../errors/HttpError";
import type { VersionedInvitation } from "../types/invitation";
import { parseCreateInvitationInput } from "../validation/createInvitationInput";
import { parseUpdateInvitationInput } from "../validation/updateInvitationInput";
import { parseChangeInvitationCapacityInput } from "../validation/changeInvitationCapacityInput";
import { parseGuestIndex } from "../validation/guestIndex";
import { parseUpdateGuestInput } from "../validation/updateGuestInput";
import { parseListInvitationsQuery } from "../validation/listInvitationsQuery";
import { parseInvitationId } from "../validation/invitationId";
import { parseInvitationVersion } from "../services/invitationVersion.service";
import { parseIdempotencyKey } from "../validation/idempotencyKey";

function toHttpInvitation(invitation: VersionedInvitation) {
  return {
    ...invitation,
    archivedAt: invitation.archivedAt?.toISOString() ?? null,
    updatedAt: invitation.updatedAt?.toISOString() ?? null,
    editOverrideUntil: invitation.editOverrideUntil?.toISOString() ?? null,
  };
}

function invitationNotFound(): never {
  throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitación no encontrada");
}

export async function updateInvitationGuestController(
  request: Request<{ id: string; guestIndex: string }>,
  response: Response,
): Promise<void> {
  const id = parseInvitationId(request.params.id);
  const guestIndex = parseGuestIndex(request.params.guestIndex);
  const values = request.headersDistinct["x-invitation-version"];
  const version = parseInvitationVersion(values?.length === 1 ? values[0] : values);
  const { name } = parseUpdateGuestInput(request.body);
  const invitation = await updateInvitationGuest(id, guestIndex, name, version);
  if (!invitation) invitationNotFound();
  response.status(200).json(toHttpInvitation(invitation));
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
  const values = request.headersDistinct?.["idempotency-key"];
  const key = parseIdempotencyKey(values?.length === 1 ? values[0] : values);
  if (key !== undefined) {
    const result = await createInvitationIdempotently(input, key);
    response.status(result.created ? 201 : 200).json(toHttpInvitation(result.invitation));
    return;
  }
  const invitation = await createInvitation(input);
  response.status(201).json(toHttpInvitation(invitation));
}

export async function updateInvitationController(
  request: Request<{ id: string }>,
  response: Response,
): Promise<void> {
  const input = parseUpdateInvitationInput(request.body);
  let invitation: VersionedInvitation | null;
  if (Object.hasOwn(input, "editOverrideUntil")) {
    const id = parseInvitationId(request.params.id);
    const values = request.headersDistinct["x-invitation-version"];
    const version = parseInvitationVersion(values?.length === 1 ? values[0] : values);
    invitation = await updateInvitation(id, input, version);
  } else {
    invitation = await updateInvitation(request.params.id, input);
  }
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
  const values = request.headersDistinct["x-invitation-version"];
  const version = parseInvitationVersion(values?.length === 1 ? values[0] : values);
  const invitation = await restoreInvitationReplacement(
    request.params.id,
    guestIndex,
    version,
  );
  if (!invitation) invitationNotFound();
  response.status(200).json(toHttpInvitation(invitation));
}

async function respondWithArchiveState(
  invitationPromise: Promise<VersionedInvitation | null>,
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

export async function removeInvitationGuestController(
  request: Request<{ id: string; guestIndex: string }>,
  response: Response,
): Promise<void> {
  const id = parseInvitationId(request.params.id);
  const guestIndex = parseGuestIndex(request.params.guestIndex);
  const values = request.headersDistinct["x-invitation-version"];
  const version = parseInvitationVersion(values?.length === 1 ? values[0] : values);
  const invitation = await removeInvitationGuest(id, guestIndex, version);
  if (!invitation) invitationNotFound();
  response.status(200).json(toHttpInvitation(invitation));
}
