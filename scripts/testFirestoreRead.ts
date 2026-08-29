import { firestore } from "../src/config/firebaseAdmin";

type SafeError = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  cause?: SafeError;
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
    const snapshot = await firestore.collection("invitations").limit(3).get();

    if (snapshot.empty) {
      console.log("Firestore read succeeded. The invitations collection returned no documents.");
      return;
    }

    console.log(`Firestore read succeeded. Documents read: ${snapshot.size}`);
    for (const document of snapshot.docs) {
      const { displayName, maxGuests, rsvpStatus } = document.data();
      console.log({
        id: document.id,
        displayName,
        maxGuests,
        rsvpStatus,
      });
    }
  } catch (error: unknown) {
    const safeError = error as SafeError;
    console.error("Firestore read failed.", {
      name: typeof safeError.name === "string" ? safeError.name : "Error",
      code: typeof safeError.code === "string" ? safeError.code : "unknown",
      message: sanitizedDetail(safeError.message),
      causeCode:
        typeof safeError.cause?.code === "string" ? safeError.cause.code : undefined,
      causeMessage: sanitizedDetail(safeError.cause?.message),
    });
    process.exitCode = 1;
  }
}

void testFirestoreRead();
