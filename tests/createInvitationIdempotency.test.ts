import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { CreationFirestore } from "./helpers/creationFirestore";

const mocks = vi.hoisted(() => ({ db: undefined as unknown as CreationFirestore, generateId: vi.fn() }));
vi.mock("../src/config/firebaseAdmin", () => ({ firestore: {
  collection: (name: string) => mocks.db.collection(name),
  runTransaction: (callback: Parameters<CreationFirestore["runTransaction"]>[0]) => mocks.db.runTransaction(callback),
} }));
vi.mock("../src/services/invitationId.service", () => ({ generateInvitationId: mocks.generateId }));

import { createInvitation, createInvitationIdempotently, mapInvitationDocument } from "../src/services/invitations.service";
import { createInvitationData } from "../src/services/invitationModel.service";
import { invitationVersion } from "../src/services/invitationVersion.service";
import { INVITATION_CREATION_RECEIPTS, invitationCreationReceiptId, invitationCreationFingerprint } from "../src/services/invitationCreationReceipt.service";
import { DataIntegrityError } from "../src/errors/DataIntegrityError";

const input = { displayName: "Familia Ruiz", knownGuests: [{ name: "José Ruiz" }, { name: "María Ruiz" }], openSlots: 2, replacementsAllowed: false };
const key = "creation-123";
const receiptPath = INVITATION_CREATION_RECEIPTS + "/" + invitationCreationReceiptId(key);
const fingerprint = invitationCreationFingerprint(createInvitationData(input));
const invitations = () => [...mocks.db.documents.keys()].filter(path => path.startsWith("invitations/"));

beforeEach(() => {
  mocks.db = new CreationFirestore();
  mocks.generateId.mockReset();
  let next = 0;
  mocks.generateId.mockImplementation(() => ["ABCDEFGH", "BCDEFGHJ", "CDEFGHJK"][next++ % 3]);
});

describe("persistent invitation creation idempotency", () => {
  it("keeps manual creation without receipts or transactions", async () => {
    const result = await createInvitation(input);
    expect(result.id).toBe("ABCDEFGH");
    expect(result.guests).toHaveLength(4);
    expect(result.rsvpStatus).toBe("pending");
    expect(mocks.db.documents.size).toBe(1);
    expect(mocks.db.runTransaction).not.toHaveBeenCalled();
  });
  it("atomically creates exactly one invitation and a minimal receipt", async () => {
    mocks.db.beforeCommit = (_attempt, writes) => {
      expect(mocks.db.documents.size).toBe(0);
      expect(writes.map(write => write.path)).toEqual(["invitations/ABCDEFGH", receiptPath]);
    };
    const result = await createInvitationIdempotently(input, key);
    expect(result.created).toBe(true);
    expect(result.invitation).toMatchObject({ id: "ABCDEFGH", rsvpStatus: "pending", maxGuests: 4, isArchived: false });
    expect(mocks.db.documents.size).toBe(2);
    const receipt = mocks.db.documents.get(receiptPath)!.data;
    expect(receipt).toEqual({ fingerprint, invitationId: "ABCDEFGH", createdAt: expect.any(Timestamp) });
    expect(mocks.db.documents.get("invitations/ABCDEFGH")!.data).not.toHaveProperty("fingerprint");
  });
  it("recovers after a lost response, without creating or generating another ID", async () => {
    const first = await createInvitationIdempotently(input, key);
    const calls = mocks.generateId.mock.calls.length;
    const second = await createInvitationIdempotently(structuredClone(input), key);
    expect(second).toEqual({ created: false, invitation: first.invitation });
    expect(invitations()).toEqual(["invitations/ABCDEFGH"]);
    expect(mocks.db.committedCreates).toHaveLength(2);
    expect(mocks.generateId).toHaveBeenCalledTimes(calls);
  });
  it("recovers persisted state after a new service instance and returns current version", async () => {
    const original = { ...createInvitationData(input), updatedAt: new Timestamp(10, 0), message: "RSVP cambiado", rsvpStatus: "confirmed" };
    mocks.db.put("invitations/ABCDEFGH", original);
    mocks.db.put(receiptPath, { fingerprint, invitationId: "ABCDEFGH", createdAt: new Timestamp(9, 0) });
    const result = await createInvitationIdempotently(input, key);
    expect(result.created).toBe(false);
    expect(result.invitation).toEqual({ ...mapInvitationDocument("ABCDEFGH", original), version: invitationVersion("invitations/ABCDEFGH", new Timestamp(1, 0)) });
    expect(mocks.generateId).not.toHaveBeenCalled();
    expect(mocks.db.committedCreates).toHaveLength(0);
  });
  it("treats equivalent model normalization as the same logical input", async () => {
    const first = await createInvitationIdempotently(input, key);
    const second = await createInvitationIdempotently({ ...input, displayName: "  Familia Ruiz  ", knownGuests: [{ name: "  José   Ruiz " }, { name: "María\tRuiz" }] }, key);
    expect(second).toEqual({ created: false, invitation: first.invitation });
  });
  it.each([
    { displayName: "Familia Otra" }, { knownGuests: [{ name: "Otro" }] },
    { knownGuests: [...input.knownGuests].reverse() }, { openSlots: 3 }, { replacementsAllowed: true },
  ])("rejects a different logical input %j", async change => {
    await createInvitationIdempotently(input, key);
    await expect(createInvitationIdempotently({ ...input, ...change }, key)).rejects.toMatchObject({ statusCode: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(mocks.db.committedCreates).toHaveLength(2);
    expect(invitations()).toHaveLength(1);
  });
  it.each([false, true])("handles concurrent same-key requests, different input=%s", async different => {
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>(resolve => { release = resolve; });
    mocks.db.beforeCommit = async attempt => {
      if (attempt !== 0) return;
      if (++arrivals === 2) release();
      await bothArrived;
    };
    const outcomes = await Promise.allSettled([
      createInvitationIdempotently(input, key),
      createInvitationIdempotently(different ? { ...input, openSlots: 0 } : input, key),
    ]);
    expect(invitations()).toHaveLength(1);
    expect(mocks.db.documents.size).toBe(2);
    expect(mocks.db.committedCreates).toHaveLength(2);
    const successes = outcomes.filter(outcome => outcome.status === "fulfilled");
    if (different) {
      expect(successes).toHaveLength(1);
      expect(outcomes.find(outcome => outcome.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
    } else {
      expect(successes).toHaveLength(2);
      expect(successes.map(outcome => outcome.value.created).sort()).toEqual([false, true]);
      expect(successes[0].value.invitation.id).toBe(successes[1].value.invitation.id);
    }
  });
  it("allows different keys with identical input", async () => {
    const first = await createInvitationIdempotently(input, "first");
    const second = await createInvitationIdempotently(input, "second");
    expect(first.invitation.id).not.toBe(second.invitation.id);
    expect(invitations()).toHaveLength(2);
  });
  it.each(["ABORTED", "ALREADY_EXISTS"])("recovers a candidate ID collision during commit (%s)", async conflict => {
    const other = { ...createInvitationData(input), displayName: "Unrelated invitation", updatedAt: new Timestamp(1, 0) };
    let collided = false;
    mocks.db.beforeCommit = () => {
      if (collided) return;
      collided = true;
      mocks.db.put("invitations/ABCDEFGH", other);
      if (conflict === "ALREADY_EXISTS") throw Object.assign(new Error("exists"), { code: 6 });
    };
    const result = await createInvitationIdempotently(input, key);
    expect(result.invitation.id).toBe("BCDEFGHJ");
    expect(mocks.db.documents.get("invitations/ABCDEFGH")!.data).toBe(other);
    expect(mocks.db.documents.get(receiptPath)!.data).toMatchObject({ fingerprint, invitationId: "BCDEFGHJ" });
    expect(mocks.db.committedCreates).toEqual(["invitations/BCDEFGHJ", receiptPath]);
    expect(mocks.db.runTransaction).toHaveBeenCalledTimes(conflict === "ABORTED" ? 1 : 2);
  });
  it("recovers an already-existing receipt when commit reported ALREADY_EXISTS", async () => {
    let collided = false;
    mocks.db.beforeCommit = () => {
      if (collided) return;
      collided = true;
      mocks.db.put("invitations/BCDEFGHJ", { ...createInvitationData(input), updatedAt: new Timestamp(1, 0) });
      mocks.db.put(receiptPath, { fingerprint, invitationId: "BCDEFGHJ", createdAt: new Timestamp(1, 0) });
      throw Object.assign(new Error("exists"), { code: 6 });
    };
    const result = await createInvitationIdempotently(input, key);
    expect(result).toMatchObject({ created: false, invitation: { id: "BCDEFGHJ" } });
    expect(invitations()).toEqual(["invitations/BCDEFGHJ"]);
    expect(mocks.db.committedCreates).toHaveLength(0);
  });
  it("stops after ten occupied IDs without creating a receipt", async () => {
    mocks.generateId.mockReturnValue("ABCDEFGH");
    mocks.db.put("invitations/ABCDEFGH", { occupied: true });
    await expect(createInvitationIdempotently(input, key)).rejects.toThrow("Could not generate a unique invitation ID");
    expect(mocks.generateId).toHaveBeenCalledTimes(10);
    expect(mocks.db.documents.has(receiptPath)).toBe(false);
    expect(mocks.db.committedCreates).toHaveLength(0);
  });
  it.each(["missing", "corrupt receipt", "corrupt invitation"])("does not recreate on %s", async state => {
    mocks.db.put(receiptPath, { fingerprint: state === "corrupt receipt" ? "bad" : fingerprint, invitationId: "ABCDEFGH", createdAt: new Timestamp(1, 0) });
    if (state === "corrupt invitation") mocks.db.put("invitations/ABCDEFGH", { bad: true });
    await expect(createInvitationIdempotently(input, key)).rejects.toThrow(DataIntegrityError);
    expect(mocks.generateId).not.toHaveBeenCalled();
    expect(mocks.db.committedCreates).toHaveLength(0);
  });
  it.each(["read", "commit", "reread", "lost commit response"])("does not manually retry infrastructure failure: %s", async failure => {
    if (failure === "read") mocks.db.onRead = () => { throw new Error("unavailable"); };
    if (failure === "commit") mocks.db.beforeCommit = () => { throw Object.assign(new Error("unavailable"), { code: 14 }); };
    if (failure === "reread") mocks.db.onRead = (_path, transactional) => { if (!transactional) throw new Error("reread failed"); };
    if (failure === "lost commit response") mocks.db.afterCommit = () => { throw new Error("response lost"); };
    await expect(createInvitationIdempotently(input, key)).rejects.toThrow();
    expect(mocks.db.runTransaction).toHaveBeenCalledOnce();
    expect(mocks.db.documents.size).toBe(failure === "read" || failure === "commit" ? 0 : 2);
    if (failure === "reread" || failure === "lost commit response") {
      mocks.db.onRead = undefined;
      mocks.db.afterCommit = undefined;
      const recovered = await createInvitationIdempotently(input, key);
      expect(recovered).toMatchObject({ created: false, invitation: { id: "ABCDEFGH" } });
      expect(mocks.db.committedCreates).toHaveLength(2);
    }
  });
});
