import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env";
import { auth } from "../config/firebaseAdmin";
import { sendError } from "../http/errorResponse";

export async function authenticateAdmin(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    sendError(response, 401, "UNAUTHORIZED", "Se requiere autenticación");
    return;
  }

  try {
    const decodedToken = await auth.verifyIdToken(match[1]);

    if (!env.adminFirebaseUids.includes(decodedToken.uid)) {
      sendError(response, 403, "FORBIDDEN", "Acceso denegado");
      return;
    }

    request.admin = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    next();
  } catch {
    sendError(response, 401, "UNAUTHORIZED", "Token de autenticación inválido");
  }
}
