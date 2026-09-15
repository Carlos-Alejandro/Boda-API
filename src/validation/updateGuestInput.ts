import { DomainError } from "../errors/DomainError";
import { normalizeName } from "../services/invitationModel.service";

export function parseUpdateGuestInput(body: unknown): { name: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("El cuerpo de la solicitud debe ser un objeto");
  }
  const extraField = Object.keys(body).find(field => field !== "name");
  if (extraField !== undefined) throw new DomainError(`Campo no permitido: ${extraField}`);
  if (!("name" in body) || typeof body.name !== "string" || !body.name.trim()) {
    throw new DomainError("name debe ser un texto no vacío");
  }
  return { name: normalizeName(body.name) };
}
