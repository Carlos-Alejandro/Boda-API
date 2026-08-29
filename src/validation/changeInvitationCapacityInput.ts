import { DomainError } from "../errors/DomainError";
import type { ChangeInvitationCapacityInput } from "../types/invitation";

export function parseChangeInvitationCapacityInput(
  body: unknown,
): ChangeInvitationCapacityInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("Request body must be an object");
  }

  const data = body as Record<string, unknown>;
  const fields = Object.keys(data);
  if (fields.length !== 1 || fields[0] !== "maxGuests") {
    throw new DomainError("Request body must contain only maxGuests");
  }
  if (!Number.isInteger(data.maxGuests) || (data.maxGuests as number) < 1) {
    throw new DomainError("maxGuests must be a positive integer");
  }

  return { maxGuests: data.maxGuests as number };
}
