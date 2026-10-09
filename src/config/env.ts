import "dotenv/config";

const DEFAULT_PORT = 3000;

export interface EnvironmentConfig {
  port: number;
  firebaseProjectId: string;
  useFirebaseEmulators: boolean;
  adminFirebaseUids: string[];
  corsAllowedOrigins: string[];
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCorsOrigins(value: string | undefined): string[] {
  return parseList(value).map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.origin !== origin
    ) {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    return origin;
  });
}

export function getListenHost(useFirebaseEmulators: boolean): string | undefined {
  return useFirebaseEmulators ? "127.0.0.1" : undefined;
}

export function parseEnvironment(
  source: NodeJS.ProcessEnv,
): EnvironmentConfig {
  const emulatorFlag = source.USE_FIREBASE_EMULATORS ?? "false";
  if (emulatorFlag !== "true" && emulatorFlag !== "false") {
    throw new Error("USE_FIREBASE_EMULATORS must be true or false");
  }
  const useFirebaseEmulators = emulatorFlag === "true";

  if (useFirebaseEmulators) {
    if (source.NODE_ENV !== "development") {
      throw new Error("Firebase emulators require NODE_ENV=development");
    }
    if (source.FIREBASE_PROJECT_ID?.trim() !== "demo-boda") {
      throw new Error("Emulator mode requires FIREBASE_PROJECT_ID=demo-boda");
    }
    if (source.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") {
      throw new Error("Emulator mode requires FIRESTORE_EMULATOR_HOST=127.0.0.1:8080");
    }
    if (source.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") {
      throw new Error("Emulator mode requires FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099");
    }
  }

  const port = Number(source.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const firebaseProjectId = source.FIREBASE_PROJECT_ID?.trim();
  if (!firebaseProjectId) {
    throw new Error("FIREBASE_PROJECT_ID is required");
  }

  const adminFirebaseUids = parseList(source.ADMIN_FIREBASE_UIDS);
  if (adminFirebaseUids.length === 0) {
    throw new Error("ADMIN_FIREBASE_UIDS must contain at least one UID");
  }

  return {
    port,
    firebaseProjectId,
    useFirebaseEmulators,
    adminFirebaseUids,
    corsAllowedOrigins: parseCorsOrigins(source.CORS_ALLOWED_ORIGINS),
  };
}

export const env = parseEnvironment(process.env);
