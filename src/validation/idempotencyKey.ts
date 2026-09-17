import { DomainError } from "../errors/DomainError";

export function parseIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new DomainError("Idempotency-Key debe contener entre 1 y 200 caracteres: letras ASCII, números, punto, guion, guion bajo o dos puntos; debe enviarse una sola vez.");
  }
  return value;
}
