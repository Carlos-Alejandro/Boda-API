import { DomainError } from "../errors/DomainError";
import type { UpdateInvitationInput } from "../types/invitation";

const ALLOWED_FIELDS = new Set([
  "displayName",
  "replacementsAllowed",
  "editOverrideUntil",
]);
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= lastDayOfMonth && !Number.isNaN(Date.parse(value));
}

export function parseUpdateInvitationInput(body: unknown): UpdateInvitationInput {
  if (!isObject(body)) throw new DomainError("El cuerpo de la solicitud debe ser un objeto");

  const fields = Object.keys(body);
  if (fields.length === 0) throw new DomainError("Se requiere al menos un campo");

  const extraField = fields.find((field) => !ALLOWED_FIELDS.has(field));
  if (extraField) throw new DomainError(`Campo no permitido: ${extraField}`);

  const input: UpdateInvitationInput = {};

  if (Object.hasOwn(body, "displayName")) {
    if (typeof body.displayName !== "string" || !body.displayName.trim()) {
      throw new DomainError("displayName debe ser un texto no vacío");
    }
    input.displayName = body.displayName.trim();
  }

  if (Object.hasOwn(body, "replacementsAllowed")) {
    if (typeof body.replacementsAllowed !== "boolean") {
      throw new DomainError("replacementsAllowed debe ser un valor booleano");
    }
    input.replacementsAllowed = body.replacementsAllowed;
  }

  if (Object.hasOwn(body, "editOverrideUntil")) {
    if (body.editOverrideUntil === null) {
      input.editOverrideUntil = null;
    } else {
      if (
        typeof body.editOverrideUntil !== "string" ||
        !isValidIsoDate(body.editOverrideUntil)
      ) {
        throw new DomainError("editOverrideUntil debe ser una fecha ISO válida o null");
      }
      const date = new Date(body.editOverrideUntil);
      if (Number.isNaN(date.getTime())) {
        throw new DomainError("editOverrideUntil debe ser una fecha ISO válida o null");
      }
      input.editOverrideUntil = date;
    }
  }

  return input;
}
