import { DomainError } from "../errors/DomainError";
import type { CreateInvitationInput } from "../types/invitation";

const ALLOWED_FIELDS = new Set([
  "displayName",
  "knownGuests",
  "openSlots",
  "replacementsAllowed",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCreateInvitationInput(body: unknown): CreateInvitationInput {
  if (!isObject(body)) throw new DomainError("El cuerpo de la solicitud debe ser un objeto");

  const extraFields = Object.keys(body).filter((field) => !ALLOWED_FIELDS.has(field));
  if (extraFields.length > 0) {
    throw new DomainError(`Campo no permitido: ${extraFields[0]}`);
  }
  if (typeof body.displayName !== "string" || !body.displayName.trim()) {
    throw new DomainError("displayName debe ser un texto no vacío");
  }
  if (!Array.isArray(body.knownGuests)) {
    throw new DomainError("knownGuests debe ser un arreglo");
  }

  const knownGuests = body.knownGuests.map((value, index) => {
    if (!isObject(value)) {
      throw new DomainError(`knownGuests[${index}] debe ser un objeto`);
    }
    const fields = Object.keys(value);
    if (fields.some((field) => field !== "name")) {
      throw new DomainError(`Campo no permitido en knownGuests[${index}]`);
    }
    if (typeof value.name !== "string" || !value.name.trim()) {
      throw new DomainError(`knownGuests[${index}].name debe ser un texto no vacío`);
    }
    return { name: value.name };
  });

  if (!Number.isInteger(body.openSlots) || (body.openSlots as number) < 0) {
    throw new DomainError("openSlots debe ser un número entero mayor o igual a cero");
  }
  if (typeof body.replacementsAllowed !== "boolean") {
    throw new DomainError("replacementsAllowed debe ser un valor booleano");
  }
  if (knownGuests.length + (body.openSlots as number) < 1) {
    throw new DomainError("La invitación debe tener al menos un lugar para un invitado");
  }

  return {
    displayName: body.displayName,
    knownGuests,
    openSlots: body.openSlots as number,
    replacementsAllowed: body.replacementsAllowed,
  };
}
