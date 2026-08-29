import "dotenv/config";

const DEFAULT_PORT = 3000;

export interface EnvironmentConfig {
  port: number;
  firebaseProjectId: string;
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

export function parseEnvironment(
  source: NodeJS.ProcessEnv,
): EnvironmentConfig {
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
    adminFirebaseUids,
    corsAllowedOrigins: parseCorsOrigins(source.CORS_ALLOWED_ORIGINS),
  };
}

export const env = parseEnvironment(process.env);
