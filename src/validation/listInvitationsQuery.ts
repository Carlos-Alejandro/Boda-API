import { DomainError } from "../errors/DomainError";
import type { ListInvitationFilters, RsvpStatus } from "../types/invitation";

const ALLOWED_FIELDS = new Set(["search", "rsvpStatus", "archived"]);
const RSVP_STATUSES = new Set<RsvpStatus>([
  "pending",
  "confirmed",
  "partial",
  "declined",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseListInvitationsQuery(query: unknown): ListInvitationFilters {
  if (!isObject(query)) throw new DomainError("Los parámetros de consulta deben ser un objeto");

  const extraField = Object.keys(query).find((field) => !ALLOWED_FIELDS.has(field));
  if (extraField) throw new DomainError(`Parámetro de consulta no permitido: ${extraField}`);

  const filters: ListInvitationFilters = {};

  if (Object.hasOwn(query, "search")) {
    if (typeof query.search !== "string") {
      throw new DomainError("search debe ser un texto");
    }
    const search = query.search.trim();
    if (search) filters.search = search;
  }

  if (Object.hasOwn(query, "rsvpStatus")) {
    if (
      typeof query.rsvpStatus !== "string" ||
      !RSVP_STATUSES.has(query.rsvpStatus as RsvpStatus)
    ) {
      throw new DomainError("rsvpStatus es inválido");
    }
    filters.rsvpStatus = query.rsvpStatus as RsvpStatus;
  }

  if (Object.hasOwn(query, "archived")) {
    if (query.archived !== "true" && query.archived !== "false") {
      throw new DomainError('archived debe ser "true" o "false"');
    }
    filters.archived = query.archived === "true";
  }

  return filters;
}
