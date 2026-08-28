import "dotenv/config";

const DEFAULT_PORT = 3000;
const parsedPort = Number(process.env.PORT ?? DEFAULT_PORT);
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID?.trim() || undefined;
const adminFirebaseUids = (process.env.ADMIN_FIREBASE_UIDS ?? "")
  .split(",")
  .map((uid) => uid.trim())
  .filter(Boolean);

if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

export const env = {
  port: parsedPort,
  firebaseProjectId,
  adminFirebaseUids,
} as const;
