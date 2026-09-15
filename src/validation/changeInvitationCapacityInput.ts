import { DomainError } from "../errors/DomainError";
import type { ChangeInvitationCapacityInput } from "../types/invitation";

export function parseChangeInvitationCapacityInput(
  body: unknown,
): ChangeInvitationCapacityInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("El cuerpo de la solicitud debe ser un objeto");
  }

  const data = body as Record<string, unknown>;
  const fields = Object.keys(data);
  if (fields.length !== 1 || fields[0] !== "maxGuests") {
    throw new DomainError("El cuerpo de la solicitud debe contener únicamente maxGuests");
  }
  if (!Number.isInteger(data.maxGuests) || (data.maxGuests as number) < 1) {
    throw new DomainError("maxGuests debe ser un número entero mayor que cero");
  }

  return { maxGuests: data.maxGuests as number };
}
