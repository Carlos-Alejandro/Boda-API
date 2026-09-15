import { request as httpRequest } from "node:http";
import type { Server } from "node:http";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(), removeInvitationGuest: vi.fn(),
  getInvitationById: vi.fn(), listInvitations: vi.fn(), createInvitation: vi.fn(),
  updateInvitation: vi.fn(), changeCapacity: vi.fn(), restoreInvitationReplacement: vi.fn(),
  archiveInvitation: vi.fn(), restoreArchivedInvitation: vi.fn(),
}));
vi.mock("../src/config/env", () => ({ env: { adminFirebaseUids: ["admin"], corsAllowedOrigins: ["https://admin.example.com"] } }));
vi.mock("../src/config/firebaseAdmin", () => ({ auth: { verifyIdToken: mocks.verifyIdToken } }));
vi.mock("../src/services/invitations.service", () => mocks);
import app from "../src/app";
import { invitationVersion } from "../src/services/invitationVersion.service";
import { HttpError } from "../src/errors/HttpError";
const version = invitationVersion("invitations/legacy-id", new Timestamp(100, 123456000));
const invitation = {
  id: "legacy-id", version, displayName: "Family", maxGuests: 1, replacementsAllowed: true,
  rsvpStatus: "partial", message: "Saved", isArchived: false, archivedAt: null,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"), editOverrideUntil: null,
  guests: [{ name: "Edgar", shortName: "Edgar", type: "known", attending: true }],
};
const basePath = "/api/admin/invitations";
let server: Server; let base: string;
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  base = "http://127.0.0.1:" + address.port;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.verifyIdToken.mockResolvedValue({ uid: "admin" });
  for (const [name, mock] of Object.entries(mocks)) {
    if (name !== "verifyIdToken") mock.mockResolvedValue(name === "listInvitations" ? [invitation] : invitation);
  }
});
const remove = (headers: Record<string, string> = { Authorization: "Bearer valid", "X-Invitation-Version": version }, path = basePath + "/legacy-id/guests/0/remove") => fetch(base + path, { method: "POST", headers });

describe("remove HTTP", () => {
  it("requires authentication", async () => {
    const response = await remove({ "X-Invitation-Version": version });
    expect(response.status).toBe(401);
    expect(mocks.removeInvitationGuest).not.toHaveBeenCalled();
  });
  it("rejects non-admin", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "other" });
    expect((await remove()).status).toBe(403);
    expect(mocks.removeInvitationGuest).not.toHaveBeenCalled();
  });
  it.each([
    [{ Authorization: "Bearer valid" }, "Se requiere el encabezado X-Invitation-Version"],
    [{ Authorization: "Bearer valid", "X-Invitation-Version": "invalid" }, "El encabezado X-Invitation-Version es inválido"],
    [{ Authorization: "Bearer valid", "If-Match": version }, "Se requiere el encabezado X-Invitation-Version"],
  ])("validates headers %j", async (headers, message) => {
    const response = await remove(headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR", message } });
    expect(mocks.removeInvitationGuest).not.toHaveBeenCalled();
  });
  it("rejects duplicate header lines even when identical", async () => {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(base + basePath + "/legacy-id/guests/0/remove", {
        method: "POST", headers: { Authorization: "Bearer valid", "X-Invitation-Version": [version, version] },
      }, res => { let body = ""; res.on("data", chunk => body += chunk); res.on("end", () => resolve({ status: res.statusCode!, body })); });
      req.on("error", reject); req.end();
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error.message).toBe("El encabezado X-Invitation-Version es inválido");
  });
  it.each(["a%2Fb", "a%2Fb%2Fc"])("rejects encoded slash in %s", async id => {
    const response = await remove(undefined, basePath + "/" + id + "/guests/0/remove");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("ID de invitación inválido");
    expect(mocks.removeInvitationGuest).not.toHaveBeenCalled();
  });
  it("does not decode ID twice", async () => {
    expect((await remove(undefined, basePath + "/a%252Fb/guests/0/remove")).status).toBe(200);
    expect(mocks.removeInvitationGuest).toHaveBeenCalledWith("a%2Fb", 0, version);
  });
  it.each(["-1", "1.5", "+1", "%201", "abc", "01", "9007199254740992"])("rejects index %s", async index => {
    const response = await remove(undefined, basePath + "/legacy-id/guests/" + index + "/remove");
    expect(response.status).toBe(400);
    expect(mocks.removeInvitationGuest).not.toHaveBeenCalled();
  });
  it("returns the complete invitation and version with no body in request", async () => {
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...invitation, updatedAt: invitation.updatedAt.toISOString() });
    expect(mocks.removeInvitationGuest).toHaveBeenCalledWith("legacy-id", 0, version);
  });
  it("returns exact 412", async () => {
    const message = "La invitación cambió. Recarga los datos antes de eliminar un invitado.";
    mocks.removeInvitationGuest.mockRejectedValue(new HttpError(412, "PRECONDITION_FAILED", message));
    const response = await remove();
    expect(response.status).toBe(412);
    expect(await response.json()).toEqual({ error: { code: "PRECONDITION_FAILED", message } });
  });
  it("returns 404 for missing document", async () => {
    mocks.removeInvitationGuest.mockResolvedValue(null);
    const response = await remove();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("INVITATION_NOT_FOUND");
  });
  it("hides internal errors", async () => {
    mocks.removeInvitationGuest.mockRejectedValue(new Error("private details"));
    const response = await remove();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  });
  it("allows version header in authorized preflight without opening origins", async () => {
    const headers = { Origin: "https://admin.example.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,x-invitation-version" };
    const response = await fetch(base + basePath + "/legacy-id/guests/0/remove", { method: "OPTIONS", headers });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("x-invitation-version");
    expect(response.headers.get("access-control-allow-origin")).toBe(headers.Origin);
    expect((await fetch(base + basePath, { method: "OPTIONS", headers: { ...headers, Origin: "https://evil.example.com" } })).status).toBe(403);
  });
});

describe("existing HTTP responses", () => {
  it.each([
    ["GET", "/legacy-id", undefined, 200],
    ["GET", "", undefined, 200],
    ["POST", "", { displayName: "Family", knownGuests: [{ name: "Edgar" }], openSlots: 0, replacementsAllowed: true }, 201],
    ["PATCH", "/legacy-id", { displayName: "New" }, 200],
    ["PATCH", "/legacy-id/capacity", { maxGuests: 2 }, 200],
    ["POST", "/legacy-id/archive", undefined, 200],
    ["POST", "/legacy-id/restore", undefined, 200],
  ])("%s %s returns version without requiring version input", async (method, path, body, status) => {
    const response = await fetch(base + basePath + path, { method, headers: { Authorization: "Bearer valid", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect(response.status).toBe(status);
    const result = await response.json();
    expect(path === "" && method === "GET" ? result.items[0].version : result.version).toBe(version);
  });
});
