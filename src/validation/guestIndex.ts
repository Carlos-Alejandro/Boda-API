import { DomainError } from "../errors/DomainError";

const NON_NEGATIVE_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;

export function parseGuestIndex(value: unknown): number {
  if (
    typeof value !== "string" ||
    !NON_NEGATIVE_INTEGER_PATTERN.test(value)
  ) {
    throw new DomainError("guestIndex must be a non-negative integer");
  }

  const guestIndex = Number(value);
  if (!Number.isSafeInteger(guestIndex)) {
    throw new DomainError("guestIndex must be a non-negative integer");
  }
  return guestIndex;
}
