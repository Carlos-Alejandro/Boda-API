import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  collection: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock("../src/config/env", () => ({
  env: { adminFirebaseUids: ["authorized-admin"], corsAllowedOrigins: [] },
}));
vi.mock("../src/config/firebaseAdmin", () => ({
  auth: { verifyIdToken: mocks.verifyIdToken },
  firestore: { collection: mocks.collection, runTransaction: mocks.runTransaction },
}));

import app from "../src/app";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

beforeEach(() => {
  mocks.verifyIdToken.mockReset().mockResolvedValue({ uid: "not-authorized" });
  mocks.collection.mockClear();
  mocks.runTransaction.mockClear();
});

describe("admin routes reject unauthorized Firebase users before accessing Firestore", () => {
  it.each([
    ["GET", "/api/admin/health"],
    ["GET", "/api/admin/invitations"],
    ["GET", "/api/admin/invitations/sample-id"],
    ["POST", "/api/admin/invitations"],
    ["PATCH", "/api/admin/invitations/sample-id"],
    ["PATCH", "/api/admin/invitations/sample-id/capacity"],
    ["PATCH", "/api/admin/invitations/sample-id/guests/0"],
    ["POST", "/api/admin/invitations/sample-id/guests/0/remove"],
    ["POST", "/api/admin/invitations/sample-id/guests/0/restore-replacement"],
    ["POST", "/api/admin/invitations/sample-id/archive"],
    ["POST", "/api/admin/invitations/sample-id/restore"],
  ])("returns 403 for %s %s before data access", async (method, path) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: "Bearer valid-firebase-token", "Content-Type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN", message: "Acceso denegado" } });
    expect(mocks.verifyIdToken).toHaveBeenCalledOnce();
    expect(mocks.collection).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
});
