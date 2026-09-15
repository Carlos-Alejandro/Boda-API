import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));

vi.mock("../src/config/env", () => ({
  env: { adminFirebaseUids: ["admin-uid"] },
}));
vi.mock("../src/config/firebaseAdmin", () => ({
  auth: { verifyIdToken: authMocks.verifyIdToken },
}));

import { authenticateAdmin } from "../src/middlewares/authenticateAdmin";

function responseMock() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
}

function requestMock(authorization?: string) {
  return {
    header: vi.fn(() => authorization),
  } as unknown as Request;
}

describe("authenticateAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns uniform 401 when the Bearer token is missing", async () => {
    const response = responseMock();
    await authenticateAdmin(requestMock(), response, vi.fn());
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "UNAUTHORIZED", message: "Se requiere autenticación" },
    });
    expect(authMocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it("returns uniform 401 without leaking an invalid token error", async () => {
    authMocks.verifyIdToken.mockRejectedValue(
      new Error("Firebase internal token detail"),
    );
    const response = responseMock();
    await authenticateAdmin(
      requestMock("Bearer secret-token"),
      response,
      vi.fn(),
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "UNAUTHORIZED", message: "Token de autenticación inválido" },
    });
  });

  it("returns uniform 403 for an authenticated but unauthorized UID", async () => {
    authMocks.verifyIdToken.mockResolvedValue({ uid: "other-uid" });
    const response = responseMock();
    await authenticateAdmin(
      requestMock("Bearer valid-token"),
      response,
      vi.fn(),
    );
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: "FORBIDDEN", message: "Acceso denegado" },
    });
  });

  it("continues for an authorized UID", async () => {
    authMocks.verifyIdToken.mockResolvedValue({
      uid: "admin-uid",
      email: "admin@example.com",
    });
    const request = requestMock("Bearer valid-token");
    const next = vi.fn() as NextFunction;
    await authenticateAdmin(request, responseMock(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(request.admin).toEqual({
      uid: "admin-uid",
      email: "admin@example.com",
    });
  });
});
