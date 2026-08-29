import cors from "cors";

import { env } from "../config/env";
import { HttpError } from "../errors/HttpError";

export function createCorsMiddleware(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);

  return cors({
    origin(origin, callback) {
      if (origin === undefined || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, "FORBIDDEN", "Forbidden"));
    },
  });
}

export const corsMiddleware = createCorsMiddleware(env.corsAllowedOrigins);
