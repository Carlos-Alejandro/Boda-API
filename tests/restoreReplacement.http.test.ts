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
import { DomainError } from "../src/errors/DomainError";
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
const restore = (headers: Record<string, string> = { Authorization: "Bearer valid", "X-Invitation-Version": version }, path = basePath + "/legacy-id/guests/0/restore-replacement") => fetch(base + path, { method: "POST", headers });

describe("restore-replacement HTTP", () => {
  it("requires authentication", async () => {
    const response = await restore({ "X-Invitation-Version": version });
    expect(response.status).toBe(401);
    expect(mocks.restoreInvitationReplacement).not.toHaveBeenCalled();
  });
  it("rejects non-admin", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "other" });
    expect((await restore()).status).toBe(403);
    expect(mocks.restoreInvitationReplacement).not.toHaveBeenCalled();
  });
  it.each([
    [{ Authorization: "Bearer valid" }, "X-Invitation-Version header is required"],
    [{ Authorization: "Bearer valid", "X-Invitation-Version": "invalid" }, "X-Invitation-Version header is invalid"],
    [{ Authorization: "Bearer valid", "If-Match": version }, "X-Invitation-Version header is required"],
  ])("validates headers %j", async (headers, message) => {
    const response = await restore(headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR", message } });
    expect(mocks.restoreInvitationReplacement).not.toHaveBeenCalled();
  });
  it("rejects duplicate header lines even when identical", async () => {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(base + basePath + "/legacy-id/guests/0/restore-replacement", {
        method: "POST", headers: { Authorization: "Bearer valid", "X-Invitation-Version": [version, version] },
      }, res => { let body = ""; res.on("data", chunk => body += chunk); res.on("end", () => resolve({ status: res.statusCode!, body })); });
      req.on("error", reject); req.end();
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error.message).toBe("X-Invitation-Version header is invalid");
  });
  it.each(["-1", "1.5", "+1", "%201", "abc", "01", "9007199254740992"])("rejects index %s", async index => {
    const response = await restore(undefined, basePath + "/legacy-id/guests/" + index + "/restore-replacement");
    expect(response.status).toBe(400);
    expect(mocks.restoreInvitationReplacement).not.toHaveBeenCalled();
  });
  it("returns the complete invitation and version with no body in request", async () => {
    const nextVersion = invitationVersion("invitations/legacy-id", new Timestamp(101, 0));
    mocks.restoreInvitationReplacement.mockResolvedValue({ ...invitation, version: nextVersion });
    const response = await restore();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...invitation, version: nextVersion, updatedAt: invitation.updatedAt.toISOString() });
    expect(mocks.restoreInvitationReplacement).toHaveBeenCalledWith("legacy-id", 0, version);
  });
  it("returns exact 412", async () => {
    const message = "Invitation has changed; reload before restoring a replacement";
    mocks.restoreInvitationReplacement.mockRejectedValue(new HttpError(412, "PRECONDITION_FAILED", message));
    const response = await restore();
    expect(response.status).toBe(412);
    expect(await response.json()).toEqual({ error: { code: "PRECONDITION_FAILED", message } });
  });
  it.each(["Only a replacement guest can be restored", "guestIndex is out of range"])("preserves 400: %s", async message => {
    mocks.restoreInvitationReplacement.mockRejectedValue(new DomainError(message));
    const response = await restore();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR", message } });
  });
  it("returns 404 for missing document", async () => {
    mocks.restoreInvitationReplacement.mockResolvedValue(null);
    const response = await restore();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("INVITATION_NOT_FOUND");
  });
  it("hides internal errors", async () => {
    mocks.restoreInvitationReplacement.mockRejectedValue(new Error("private details"));
    const response = await restore();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
  it("allows version header in authorized preflight without opening origins", async () => {
    const headers = { Origin: "https://admin.example.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,x-invitation-version" };
    const response = await fetch(base + basePath + "/legacy-id/guests/0/restore-replacement", { method: "OPTIONS", headers });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("x-invitation-version");
    expect(response.headers.get("access-control-allow-origin")).toBe(headers.Origin);
    expect((await fetch(base + basePath, { method: "OPTIONS", headers: { ...headers, Origin: "https://evil.example.com" } })).status).toBe(403);
  });
});

