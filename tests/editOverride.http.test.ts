import { request as httpRequest, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(), get: vi.fn(), update: vi.fn(),
  transactionGet: vi.fn(), transactionUpdate: vi.fn(), runTransaction: vi.fn(),
}));
vi.mock("../src/config/env", () => ({ env: {
  adminFirebaseUids: ["admin"], corsAllowedOrigins: ["https://admin.example.com"],
} }));
vi.mock("../src/config/firebaseAdmin", () => ({
  auth: { verifyIdToken: mocks.verifyIdToken },
  firestore: {
    collection: () => ({ doc: () => ({ get: mocks.get, update: mocks.update }) }),
    runTransaction: mocks.runTransaction,
  },
}));

import app from "../src/app";
import { invitationVersion } from "../src/services/invitationVersion.service";

const now = Date.parse("2028-03-15T03:00:00.000Z");
const future = "2028-03-16T03:00:00.000Z";
const stamp = new Timestamp(100, 0);
const nextStamp = new Timestamp(101, 0);
const version = invitationVersion("invitations/test-override", stamp);
const nextVersion = invitationVersion("invitations/test-override", nextStamp);
const initial = () => ({
  displayName: "Familia Pérez", maxGuests: 1, replacementsAllowed: true,
  rsvpStatus: "confirmed", message: "Mensaje guardado", isArchived: false,
  archivedAt: null, editOverrideUntil: null, updatedAt: stamp,
  guests: [{ name: "Ana", shortName: "Ana", type: "known", attending: true, legacy: "preservar" }],
  legacyInvitation: { nested: true },
});
let stored: Record<string, unknown>;
let updateTime: Timestamp;
const snapshot = () => ({
  exists: true, id: "test-override", ref: { path: "invitations/test-override" },
  updateTime, data: () => stored,
});
const transaction = { get: mocks.transactionGet, update: mocks.transactionUpdate };
let server: Server;
let url: string;

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  url = `http://127.0.0.1:${address.port}/api/admin/invitations/test-override`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now);
  stored = initial();
  updateTime = stamp;
  mocks.verifyIdToken.mockResolvedValue({ uid: "admin" });
  mocks.get.mockImplementation(async () => snapshot());
  mocks.transactionGet.mockImplementation(async () => snapshot());
  // Apply staged fields only after the transaction callback succeeds.
  mocks.runTransaction.mockImplementation(async callback => {
    const result = await callback(transaction);
    const write = mocks.transactionUpdate.mock.calls.at(-1)?.[1];
    if (write) {
      stored = { ...stored, ...write, updatedAt: nextStamp };
      updateTime = nextStamp;
    }
    return result;
  });
  mocks.update.mockImplementation(async changes => {
    stored = { ...stored, ...changes, updatedAt: nextStamp };
    updateTime = nextStamp;
  });
});
afterEach(() => vi.restoreAllMocks());

const headers = { Authorization: "Bearer valid", "X-Invitation-Version": version };
const patch = (body: unknown, customHeaders: Record<string, string> = headers) => fetch(url, {
  method: "PATCH", headers: { "Content-Type": "application/json", ...customHeaders }, body: JSON.stringify(body),
});
const expectError = async (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code, message: expect.any(String) } });
};

describe("PATCH extraordinary RSVP permission HTTP", () => {
  it("grants with an offset, preserves state and returns full invitation with UTC and new version", async () => {
    const response = await patch({ editOverrideUntil: "2028-03-15T22:00:00-05:00" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "test-override", version: nextVersion,
      displayName: "Familia Pérez", maxGuests: 1, replacementsAllowed: true,
      rsvpStatus: "confirmed", message: "Mensaje guardado", isArchived: false,
      archivedAt: null, editOverrideUntil: future, updatedAt: nextStamp.toDate().toISOString(),
      guests: [{ name: "Ana", shortName: "Ana", type: "known", attending: true }],
    });
    expect(mocks.transactionUpdate.mock.calls[0][1]).toEqual({
      editOverrideUntil: Timestamp.fromDate(new Date(future)), updatedAt: FieldValue.serverTimestamp(),
    });
    expect(stored.guests).toEqual(initial().guests);
    expect(stored.legacyInvitation).toEqual(initial().legacyInvitation);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([false, true])("revokes with null, archived=%s", async isArchived => {
    stored = { ...stored, isArchived, archivedAt: isArchived ? stamp : null, editOverrideUntil: Timestamp.fromDate(new Date(future)) };
    const response = await patch({ editOverrideUntil: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ editOverrideUntil: null, version: nextVersion, isArchived });
    expect(mocks.transactionUpdate.mock.calls[0][1]).toEqual({ editOverrideUntil: null, updatedAt: FieldValue.serverTimestamp() });
  });
  it.each([future, null])("requires version for %j", async editOverrideUntil => {
    await expectError(await patch({ editOverrideUntil }, { Authorization: "Bearer valid" }), 400, "VALIDATION_ERROR");
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
  it("rejects malformed version", async () => {
    await expectError(await patch({ editOverrideUntil: future }, { ...headers, "X-Invitation-Version": "invalid" }), 400, "VALIDATION_ERROR");
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
  it("rejects duplicate version headers", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(url, { method: "PATCH", headers: {
        Authorization: "Bearer valid", "Content-Type": "application/json", "X-Invitation-Version": [version, version],
      } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode!)); });
      request.on("error", reject);
      request.end(JSON.stringify({ editOverrideUntil: null }));
    });
    expect(status).toBe(400);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
  it.each(["2028-03-15T02:59:59.999Z", "2028-03-15T03:00:00.000Z"])("rejects non-future %s", async editOverrideUntil => {
    await expectError(await patch({ editOverrideUntil }), 400, "VALIDATION_ERROR");
    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it("rejects a future grant in archived invitation", async () => {
    stored = { ...stored, isArchived: true, archivedAt: stamp };
    await expectError(await patch({ editOverrideUntil: future }), 400, "VALIDATION_ERROR");
    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
    expect(stored.isArchived).toBe(true);
  });
  it.each([{}, { Authorization: "Bearer invalid" }])("rejects unauthenticated requests %j", async authHeaders => {
    mocks.verifyIdToken.mockRejectedValue(new Error("invalid token"));
    await expectError(await patch({ editOverrideUntil: future }, { "X-Invitation-Version": version, ...authHeaders }), 401, "UNAUTHORIZED");
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
  it("rejects non-admin", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "other" });
    await expectError(await patch({ editOverrideUntil: future }), 403, "FORBIDDEN");
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
  it("returns 404 for missing invitation", async () => {
    mocks.transactionGet.mockResolvedValue({ exists: false });
    await expectError(await patch({ editOverrideUntil: future }), 404, "INVITATION_NOT_FOUND");
    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });
  it("rejects stale combined update before archive policy, preserving all fields", async () => {
    stored = { ...stored, isArchived: true, archivedAt: stamp };
    const original = stored;
    updateTime = nextStamp;
    const response = await patch({ editOverrideUntil: future, displayName: "Changed", replacementsAllowed: false });
    expect(response.status).toBe(412);
    expect(await response.json()).toEqual({ error: {
      code: "PRECONDITION_FAILED",
      message: "La invitación cambió. Recarga los datos antes de modificar el permiso extraordinario.",
    } });
    expect(stored).toBe(original);
    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("updates a combined body in one transaction with existing normalization", async () => {
    const response = await patch({ editOverrideUntil: future, displayName: "  Familia Actualizada  ", replacementsAllowed: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ editOverrideUntil: future, displayName: "Familia Actualizada", replacementsAllowed: false, version: nextVersion });
    expect(mocks.transactionUpdate).toHaveBeenCalledOnce();
    expect(mocks.transactionUpdate.mock.calls[0][1]).toEqual({
      editOverrideUntil: Timestamp.fromDate(new Date(future)), displayName: "Familia Actualizada",
      replacementsAllowed: false, updatedAt: FieldValue.serverTimestamp(),
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["read", "commit", "reread"])("returns safe 500 without retry after %s failure", async failure => {
    if (failure === "read") mocks.transactionGet.mockRejectedValue(new Error("private details"));
    if (failure === "commit") mocks.runTransaction.mockImplementation(async callback => { await callback(transaction); throw new Error("private details"); });
    if (failure === "reread") mocks.get.mockRejectedValue(new Error("private details"));
    const response = await patch({ editOverrideUntil: future });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
    expect(mocks.runTransaction).toHaveBeenCalledOnce();
  });
  it.each([
    { displayName: "Updated" }, { replacementsAllowed: false },
    { displayName: "Updated", replacementsAllowed: false },
  ])("keeps ordinary PATCH working without version: %j", async body => {
    const response = await patch(body, { Authorization: "Bearer valid" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ...body, version: nextVersion });
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  it.each(["guests", "rsvpStatus", "message", "maxGuests", "isArchived", "archivedAt", "updatedAt"])("rejects forbidden combined field %s", async field => {
    await expectError(await patch({ editOverrideUntil: future, [field]: "forced" }), 400, "VALIDATION_ERROR");
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
});
