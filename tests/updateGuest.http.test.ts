import { request as httpRequest } from "node:http";
import type { Server } from "node:http";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(), updateInvitationGuest: vi.fn(),
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
  id: "legacy-id", version: invitationVersion("invitations/legacy-id", new Timestamp(101, 0)), displayName: "Family", maxGuests: 1, replacementsAllowed: true,
  rsvpStatus: "partial", message: "Saved", isArchived: false, archivedAt: null,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"), editOverrideUntil: null,
  guests: [{ name: "José Carlos Martínez", shortName: "José", type: "known", attending: true }],
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
const update = (headers: Record<string, string> = { Authorization: "Bearer valid", "X-Invitation-Version": version }, path = basePath + "/legacy-id/guests/0") => fetch(base + path, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ name: "  José   Carlos Martínez  " }) });

describe("update guest HTTP", () => {
  it("requires authentication", async () => {
    const response = await update({ "X-Invitation-Version": version });
    expect(response.status).toBe(401);
    expect(mocks.updateInvitationGuest).not.toHaveBeenCalled();
  });
  it("rejects non-admin", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "other" });
    expect((await update()).status).toBe(403);
    expect(mocks.updateInvitationGuest).not.toHaveBeenCalled();
  });
  it.each([
    [{ Authorization: "Bearer valid" }, "Se requiere el encabezado X-Invitation-Version"],
    [{ Authorization: "Bearer valid", "X-Invitation-Version": "invalid" }, "El encabezado X-Invitation-Version es inválido"],
    [{ Authorization: "Bearer valid", "If-Match": version }, "Se requiere el encabezado X-Invitation-Version"],
  ])("validates headers %j", async (headers, message) => {
    const response = await update(headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR", message } });
    expect(mocks.updateInvitationGuest).not.toHaveBeenCalled();
  });
  it("rejects duplicate header lines even when identical", async () => {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(base + basePath + "/legacy-id/guests/0", {
        method: "PATCH", headers: { Authorization: "Bearer valid", "X-Invitation-Version": [version, version] },
      }, res => { let body = ""; res.on("data", chunk => body += chunk); res.on("end", () => resolve({ status: res.statusCode!, body })); });
      req.on("error", reject); req.end();
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error.message).toBe("El encabezado X-Invitation-Version es inválido");
  });
  it.each(["a%2Fb", "a%2Fb%2Fc"])("rejects encoded slash in %s", async id => {
    const response = await update(undefined, basePath + "/" + id + "/guests/0");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("ID de invitación inválido");
    expect(mocks.updateInvitationGuest).not.toHaveBeenCalled();
  });
  it("does not decode ID twice", async () => {
    expect((await update(undefined, basePath + "/a%252Fb/guests/0")).status).toBe(200);
    expect(mocks.updateInvitationGuest).toHaveBeenCalledWith("a%2Fb", 0, "José Carlos Martínez", version);
  });
  it.each(["-1", "1.5", "+1", "%201", "abc", "01", "9007199254740992"])("rejects index %s", async index => {
    const response = await update(undefined, basePath + "/legacy-id/guests/" + index);
    expect(response.status).toBe(400);
    expect(mocks.updateInvitationGuest).not.toHaveBeenCalled();
  });
  it("returns complete invitation with new version and normalized input", async () => {
    const response = await update();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...invitation, updatedAt: invitation.updatedAt.toISOString() });
    expect(mocks.updateInvitationGuest).toHaveBeenCalledWith("legacy-id", 0, "José Carlos Martínez", version);
  });
  it("returns exact 412", async () => {
    const message = "La invitación cambió. Recarga los datos antes de corregir el nombre del invitado.";
    mocks.updateInvitationGuest.mockRejectedValue(new HttpError(412, "PRECONDITION_FAILED", message));
    const response = await update();
    expect(response.status).toBe(412);
    expect(await response.json()).toEqual({ error: { code: "PRECONDITION_FAILED", message } });
  });
  it("returns 404 for missing document", async () => {
    mocks.updateInvitationGuest.mockResolvedValue(null);
    const response = await update();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("INVITATION_NOT_FOUND");
  });
  it("hides internal errors", async () => {
    mocks.updateInvitationGuest.mockRejectedValue(new Error("private details"));
    const response = await update();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  });
  it("allows version header in authorized preflight without opening origins", async () => {
    const headers = { Origin: "https://admin.example.com", "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "authorization,x-invitation-version" };
    const response = await fetch(base + basePath + "/legacy-id/guests/0", { method: "OPTIONS", headers });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("x-invitation-version");
    expect(response.headers.get("access-control-allow-origin")).toBe(headers.Origin);
    expect((await fetch(base + basePath, { method: "OPTIONS", headers: { ...headers, Origin: "https://evil.example.com" } })).status).toBe(403);
  });
});


it.each([{}, { shortName: "Alias" }, { name: "" }, { name: "   " }, ...["shortName", "attending", "type", "originalName", "unknown"].map(key => ({ name: "Ana", [key]: true }))])("rejects strict body %j", async body => {
  const response = await fetch(base + basePath + "/legacy-id/guests/0", { method: "PATCH", headers: { Authorization: "Bearer valid", "X-Invitation-Version": version, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  expect(mocks.updateInvitationGuest).not.toHaveBeenCalled();
});
it("rejects invalid bearer", async () => {
  mocks.verifyIdToken.mockRejectedValue(new Error("invalid"));
  expect((await update()).status).toBe(401);
});
it("returns 400 for out-of-range index and empty open guest", async () => {
  const { DomainError } = await import("../src/errors/DomainError");
  for (const message of ["guestIndex está fuera de rango", "Este espacio abierto todavía no tiene una persona asignada."]) {
    mocks.updateInvitationGuest.mockRejectedValue(new DomainError(message));
    const response = await update();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR", message } });
  }
});
it("returns archived invitation with serialized dates", async () => {
  mocks.updateInvitationGuest.mockResolvedValue({ ...invitation, isArchived: true, archivedAt: invitation.updatedAt, editOverrideUntil: invitation.updatedAt });
  const response = await update();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ isArchived: true, archivedAt: invitation.updatedAt.toISOString(), editOverrideUntil: invitation.updatedAt.toISOString() });
});
