import { DomainError } from "../errors/DomainError";
import type { PublicRsvpInput } from "../types/invitation";

const ALLOWED_FIELDS = new Set([
  "expectedState",
  "responses",
  "replacementNames",
  "openGuestNames",
  "message",
]);
const MAX_EXPECTED_STATE_LENGTH = 50_000;
const MAX_GUEST_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNameArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new DomainError(`${field} debe ser un arreglo`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length > MAX_GUEST_NAME_LENGTH) {
      throw new DomainError(`${field}[${index}] debe ser un texto de hasta ${MAX_GUEST_NAME_LENGTH} caracteres`);
    }
    return entry;
  });
}

export function parsePublicRsvpInput(body: unknown): PublicRsvpInput {
  if (!isObject(body)) throw new DomainError("El cuerpo de la solicitud debe ser un objeto");
  const extraField = Object.keys(body).find((field) => !ALLOWED_FIELDS.has(field));
  if (extraField) throw new DomainError(`Campo no permitido: ${extraField}`);

  if (
    typeof body.expectedState !== "string" ||
    body.expectedState.length === 0 ||
    body.expectedState.length > MAX_EXPECTED_STATE_LENGTH
  ) {
    throw new DomainError("expectedState es inválido");
  }
  if (!Array.isArray(body.responses) || body.responses.some(
    (value) => value !== true && value !== false && value !== null,
  )) {
    throw new DomainError("responses debe contener únicamente true, false o null");
  }
  if (typeof body.message !== "string" || body.message.length > MAX_MESSAGE_LENGTH) {
    throw new DomainError(`message debe ser un texto de hasta ${MAX_MESSAGE_LENGTH} caracteres`);
  }

  const replacementNames = parseNameArray(body.replacementNames, "replacementNames");
  const openGuestNames = parseNameArray(body.openGuestNames, "openGuestNames");
  if (
    body.responses.length !== replacementNames.length ||
    body.responses.length !== openGuestNames.length
  ) {
    throw new DomainError("Los arreglos del RSVP deben tener la misma longitud");
  }

  return {
    expectedState: body.expectedState,
    responses: body.responses as Array<boolean | null>,
    replacementNames,
    openGuestNames,
    message: body.message,
  };
}
