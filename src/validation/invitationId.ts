import { DomainError } from "../errors/DomainError";

export function parseInvitationId(value: unknown): string {
  if (
    typeof value !== "string" || !value || value.includes("/") ||
    value === "." || value === ".." || /^__.*__$/.test(value) ||
    Buffer.byteLength(value, "utf8") > 1500 ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  ) {
    throw new DomainError("Invalid invitation ID");
  }
  return value;
}
