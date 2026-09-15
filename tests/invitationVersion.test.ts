import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { invitationVersion, parseInvitationVersion } from "../src/services/invitationVersion.service";
import { parseInvitationId } from "../src/validation/invitationId";
import { DataIntegrityError } from "../src/errors/DataIntegrityError";
const path = "invitations/legacy-id";
const stamp = new Timestamp(100, 123456000);
const token = invitationVersion(path, stamp);
const encode = (payload: unknown) => "iv1." + Buffer.from(JSON.stringify(payload)).toString("base64url");
describe("invitation version", () => {
  it("is deterministic, canonical, and lossless within a millisecond", () => {
    const later = new Timestamp(100, 123457000);
    expect(stamp.toDate()).toEqual(later.toDate());
    expect(token).toBe(invitationVersion(path, new Timestamp(100, 123456000)));
    expect(token).not.toBe(invitationVersion(path, later));
    expect(token).not.toBe(invitationVersion("invitations/other", stamp));
    expect(parseInvitationVersion(token)).toBe(token);
    expect(JSON.parse(Buffer.from(token.slice(4), "base64url").toString())).toEqual([path, "100", "123456000"]);
  });
  it("requires updateTime", () => expect(() => invitationVersion(path, undefined)).toThrow(DataIntegrityError));
  it("requires the header", () => expect(() => parseInvitationVersion(undefined)).toThrow("Se requiere el encabezado X-Invitation-Version"));
  it.each([
    "", null, [token], token + "=", " " + token, token + "," + token, "iv2.abc", "iv1.!", "iv1." + "a".repeat(4096),
    encode({}), encode([path, "100"]), encode([path, 100, "123456000"]),
    encode([path, "0100", "123456000"]), encode([path, "-0", "123456000"]), encode([path, "+100", "123456000"]),
    encode([path, "1e2", "123456000"]), encode([path, "100", "123"]), encode([path, "100", "1000000000"]),
    encode([path, "253402300800", "000000000"]), encode([path, "-62135596801", "000000000"]),
    encode(["invitations/a/b/c", "100", "000000000"]), encode(["other/a", "100", "000000000"]),
    "iv1." + Buffer.from('[ "invitations/legacy-id", "100", "123456000" ]').toString("base64url"),
    "iv1." + Buffer.from([0xff]).toString("base64url"),
  ])("rejects malformed/noncanonical token %j", value => {
    expect(() => parseInvitationVersion(value)).toThrow("El encabezado X-Invitation-Version es inválido");
  });
  it.each([-62135596800, 0, 253402300799])("accepts timestamp seconds boundary %s", seconds => {
    const value = invitationVersion(path, new Timestamp(seconds, 999999999));
    expect(parseInvitationVersion(value)).toBe(value);
  });
});
describe("invitation ID", () => {
  it.each(["a/b", "a/b/c", "", ".", "..", "__reserved__", "a".repeat(1501), "\ud800", null])("rejects %j", id => {
    expect(() => parseInvitationId(id)).toThrow("ID de invitación inválido");
  });
  it.each(["legacy-id", "a%2Fb", "Familia historica", "x".repeat(1500)])("keeps a single segment without decoding %s", id => {
    expect(parseInvitationId(id)).toBe(id);
  });
});
