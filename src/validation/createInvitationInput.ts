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
  if (!isObject(body)) throw new DomainError("Request body must be an object");

  const extraFields = Object.keys(body).filter((field) => !ALLOWED_FIELDS.has(field));
  if (extraFields.length > 0) {
    throw new DomainError(`Unexpected field: ${extraFields[0]}`);
  }
  if (typeof body.displayName !== "string" || !body.displayName.trim()) {
    throw new DomainError("displayName must be a non-empty string");
  }
  if (!Array.isArray(body.knownGuests)) {
    throw new DomainError("knownGuests must be an array");
  }

  const knownGuests = body.knownGuests.map((value, index) => {
    if (!isObject(value)) {
      throw new DomainError(`knownGuests[${index}] must be an object`);
    }
    const fields = Object.keys(value);
    if (fields.some((field) => field !== "name")) {
      throw new DomainError(`Unexpected field in knownGuests[${index}]`);
    }
    if (typeof value.name !== "string" || !value.name.trim()) {
      throw new DomainError(`knownGuests[${index}].name must be a non-empty string`);
    }
    return { name: value.name };
  });

  if (!Number.isInteger(body.openSlots) || (body.openSlots as number) < 0) {
    throw new DomainError("openSlots must be a non-negative integer");
  }
  if (typeof body.replacementsAllowed !== "boolean") {
    throw new DomainError("replacementsAllowed must be a boolean");
  }
  if (knownGuests.length + (body.openSlots as number) < 1) {
    throw new DomainError("Invitation must have at least one guest slot");
  }

  return {
    displayName: body.displayName,
    knownGuests,
    openSlots: body.openSlots as number,
    replacementsAllowed: body.replacementsAllowed,
  };
}
