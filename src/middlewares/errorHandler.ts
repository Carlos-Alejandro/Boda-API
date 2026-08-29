import type { ErrorRequestHandler, RequestHandler } from "express";

import { DomainError } from "../errors/DomainError";
import { HttpError, resolvePublicHttpError } from "../errors/HttpError";
import { sendError } from "../http/errorResponse";

export const routeNotFound: RequestHandler = (_request, response) => {
  sendError(response, 404, "NOT_FOUND", "Route not found");
};

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 400 &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    sendError(response, 400, "VALIDATION_ERROR", "Invalid JSON body");
    return;
  }

  if (error instanceof HttpError) {
    const publicError = resolvePublicHttpError(error);
    if (publicError) {
      sendError(
        response,
        publicError.statusCode,
        publicError.code,
        publicError.message,
      );
      return;
    }
    sendError(response, 500, "INTERNAL_ERROR", "Internal server error");
    return;
  }

  if (error instanceof DomainError) {
    sendError(response, 400, "VALIDATION_ERROR", error.message);
    return;
  }

  sendError(response, 500, "INTERNAL_ERROR", "Internal server error");
};
