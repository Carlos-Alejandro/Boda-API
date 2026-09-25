import type { Request, Response } from "express";

import { savePublicRsvp } from "../services/publicRsvp.service";
import { parsePublicRsvpInput } from "../validation/publicRsvpInput";

export async function savePublicRsvpController(
  request: Request<{ id: string }>,
  response: Response,
): Promise<void> {
  const invitation = await savePublicRsvp(
    request.params.id,
    parsePublicRsvpInput(request.body),
  );
  response.status(200).json({
    id: invitation.id,
    displayName: invitation.displayName,
    maxGuests: invitation.maxGuests,
    replacementsAllowed: invitation.replacementsAllowed,
    rsvpStatus: invitation.rsvpStatus,
    message: invitation.message,
    isArchived: invitation.isArchived,
    archivedAt: invitation.archivedAt?.toISOString() ?? null,
    updatedAt: invitation.updatedAt?.toISOString() ?? null,
    editOverrideUntil: invitation.editOverrideUntil?.toISOString() ?? null,
    guests: invitation.guests,
  });
}
