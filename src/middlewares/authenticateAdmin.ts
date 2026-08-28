import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env";
import { auth } from "../config/firebaseAdmin";

export async function authenticateAdmin(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const decodedToken = await auth.verifyIdToken(match[1]);

    if (!env.adminFirebaseUids.includes(decodedToken.uid)) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }

    request.admin = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    next();
  } catch {
    response.status(401).json({ error: "Invalid authentication token" });
  }
}
