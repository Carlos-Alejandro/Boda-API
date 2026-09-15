import { Timestamp } from "firebase-admin/firestore";
import { DataIntegrityError } from "../errors/DataIntegrityError";
import { DomainError } from "../errors/DomainError";
import { parseInvitationId } from "../validation/invitationId";

export function invitationVersion(
  path: string,
  timestamp: Timestamp | undefined,
): string {
  if (!(timestamp instanceof Timestamp)) {
    throw new DataIntegrityError("Invitation snapshot is missing updateTime");
  }
  const payload = JSON.stringify([
    path,
    String(timestamp.seconds),
    String(timestamp.nanoseconds).padStart(9, "0"),
  ]);
  return "iv1." + Buffer.from(payload, "utf8").toString("base64url");
}

export function parseInvitationVersion(value: unknown): string {
  if (value === undefined) {
    throw new DomainError("Se requiere el encabezado X-Invitation-Version");
  }
  try {
    if (
      typeof value !== "string" || value.length > 4096 ||
      !/^iv1\.[A-Za-z0-9_-]+$/.test(value)
    ) throw new Error();
    const bytes = Buffer.from(value.slice(4), "base64url");
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (
      !Array.isArray(payload) || payload.length !== 3 ||
      !payload.every(v => typeof v === "string")
    ) throw new Error();
    const [path, seconds, nanos] = payload as string[];
    if (!path.startsWith("invitations/")) throw new Error();
    parseInvitationId(path.slice("invitations/".length));
    if (
      !/^(?:0|-?[1-9]\d*)$/.test(seconds) || !/^\d{9}$/.test(nanos)
    ) throw new Error();
    const timestamp = new Timestamp(Number(seconds), Number(nanos));
    if (invitationVersion(path, timestamp) !== value) throw new Error();
    return value;
  } catch {
    throw new DomainError("El encabezado X-Invitation-Version es inválido");
  }
}
