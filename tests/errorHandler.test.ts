import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../src/errors/DomainError";
import { DataIntegrityError } from "../src/errors/DataIntegrityError";
import { HttpError } from "../src/errors/HttpError";
import {
  errorHandler,
  routeNotFound,
} from "../src/middlewares/errorHandler";

function responseMock() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
}

describe("HTTP error middleware", () => {
  it("maps DomainError to a uniform 400", () => {
    const response = responseMock();
    errorHandler(
      new DomainError("Invalid request"),
      {} as Request,
      response,
      vi.fn() as NextFunction,
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "VALIDATION_ERROR", message: "Invalid request" },
    });
  });

  it("preserves malformed JSON as a safe uniform 400", () => {
    const response = responseMock();
    errorHandler(
      Object.assign(new SyntaxError("Unexpected token with body contents"), {
        status: 400,
        type: "entity.parse.failed",
      }),
      {} as Request,
      response,
      vi.fn() as NextFunction,
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "VALIDATION_ERROR", message: "El cuerpo de la solicitud no es un JSON válido" },
    });
  });

  it("maps known HTTP errors without changing their status", () => {
    const response = responseMock();
    errorHandler(
      new HttpError(404, "INVITATION_NOT_FOUND", "Invitación no encontrada"),
      {} as Request,
      response,
      vi.fn() as NextFunction,
    );
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "INVITATION_NOT_FOUND", message: "Invitación no encontrada" },
    });
  });

  it("freezes every valid HttpError at runtime", () => {
    const error = new HttpError(
      404,
      "INVITATION_NOT_FOUND",
      "Invitación no encontrada",
    );
    expect(Object.isFrozen(error)).toBe(true);

    for (const [field, value] of [
      ["statusCode", 500],
      ["code", "INTERNAL_ERROR"],
      ["message", "sensitive internal message"],
    ] as const) {
      try {
        (error as unknown as Record<string, unknown>)[field] = value;
      } catch {
        // Strict-mode assignment to a frozen object throws as expected.
      }
    }

    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("INVITATION_NOT_FOUND");
    expect(error.message).toBe("Invitación no encontrada");
  });

  it("does not reflect attempted HttpError manipulation", () => {
    const error = new HttpError(
      404,
      "INVITATION_NOT_FOUND",
      "Invitación no encontrada",
    );
    try {
      (error as unknown as { message: string }).message =
        "sensitive internal message";
    } catch {
      // The frozen instance rejects the assignment.
    }

    const response = responseMock();
    errorHandler(
      error,
      {} as Request,
      response,
      vi.fn() as NextFunction,
    );
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "INVITATION_NOT_FOUND", message: "Invitación no encontrada" },
    });
    expect(JSON.stringify((response.json as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      "sensitive internal message",
    );
  });

  it("resolves a forged HttpError only from one validated allowlist code", () => {
    let reads = 0;
    const forged = Object.create(HttpError.prototype, {
      code: {
        get: () => {
          reads += 1;
          return reads === 1 ? "INVITATION_NOT_FOUND" : "ARBITRARY_CODE";
        },
      },
      statusCode: { value: 500 },
      message: { value: "sensitive internal message" },
    }) as HttpError;
    const response = responseMock();

    errorHandler(
      forged,
      {} as Request,
      response,
      vi.fn() as NextFunction,
    );

    expect(reads).toBe(1);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "INVITATION_NOT_FOUND", message: "Invitación no encontrada" },
    });
  });

  it("rejects an HttpError status below 400", () => {
    expect(
      () => new HttpError(200, "INVITATION_NOT_FOUND", "Invitación no encontrada"),
    ).toThrow(RangeError);
  });

  it("rejects an HttpError status above 599", () => {
    expect(
      () => new HttpError(999, "INVITATION_NOT_FOUND", "Invitación no encontrada"),
    ).toThrow(RangeError);
  });

  it("rejects arbitrary HttpError codes at runtime", () => {
    expect(
      () =>
        new HttpError(
          404,
          "ARBITRARY_CODE" as "INVITATION_NOT_FOUND",
          "Invitación no encontrada",
        ),
    ).toThrow(TypeError);
  });

  it("maps persisted data integrity failures to a generic 500", () => {
    const response = responseMock();
    errorHandler(
      new DataIntegrityError(
        'Invalid invitation document "secret-id": maxGuests is invalid',
      ),
      {} as Request,
      response,
      vi.fn() as NextFunction,
    );
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" },
    });
    const payload = JSON.stringify(
      (response.json as ReturnType<typeof vi.fn>).mock.calls,
    );
    expect(payload).not.toContain("secret-id");
    expect(payload).not.toContain("maxGuests");
    expect(payload).not.toContain("Invalid invitation document");
  });

  it("returns a safe generic 500 without stack or internal message", () => {
    const response = responseMock();
    const internal = new Error("private Firebase credential failure");
    internal.stack = "sensitive/local/path";
    errorHandler(
      internal,
      {} as Request,
      response,
      vi.fn() as NextFunction,
    );
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" },
    });
    expect(JSON.stringify((response.json as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      "private Firebase",
    );
    expect(JSON.stringify((response.json as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      "sensitive/local/path",
    );
  });

  it("returns uniform JSON for an unknown route", () => {
    const response = responseMock();
    routeNotFound({} as Request, response, vi.fn() as NextFunction);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "NOT_FOUND", message: "Ruta no encontrada" },
    });
  });
});
