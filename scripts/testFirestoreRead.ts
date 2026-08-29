import { getInvitationById } from "../src/services/invitations.service";

const INVITATION_IDS = ["CS7H4K2P", "KM8P2XQ7"] as const;

type SafeError = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
};

function sanitizedDetail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  return value
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:access_token|id_token|private_key|client_secret)["'=:\s]+)[^\s,}]+/gi, "$1[REDACTED]")
    .slice(0, 500);
}

async function testFirestoreRead(): Promise<void> {
  try {
    for (const id of INVITATION_IDS) {
      const invitation = await getInvitationById(id);
      if (!invitation) {
        console.log({ id, found: false });
        continue;
      }

      console.log({
        id: invitation.id,
        displayName: invitation.displayName,
        maxGuests: invitation.maxGuests,
        rsvpStatus: invitation.rsvpStatus,
      });
    }
  } catch (error: unknown) {
    const safeError = error as SafeError;
    console.error("Firestore service read failed.", {
      name: typeof safeError.name === "string" ? safeError.name : "Error",
      code: typeof safeError.code === "string" ? safeError.code : "unknown",
      message: sanitizedDetail(safeError.message),
    });
    process.exitCode = 1;
  }
}

void testFirestoreRead();
