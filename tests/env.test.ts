import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../src/config/env";

const REQUIRED_ENV = {
  FIREBASE_PROJECT_ID: "wedding-project",
  ADMIN_FIREBASE_UIDS: "admin-1",
};

describe("environment configuration", () => {
  it("uses the development port default", () => {
    expect(parseEnvironment(REQUIRED_ENV).port).toBe(3000);
  });

  it("accepts a valid explicit port", () => {
    expect(parseEnvironment({ ...REQUIRED_ENV, PORT: "8080" }).port).toBe(8080);
  });

  it.each(["0", "65536", "3.5", "invalid"])("rejects invalid PORT=%s", (PORT) => {
    expect(() => parseEnvironment({ ...REQUIRED_ENV, PORT })).toThrow(/PORT/);
  });

  it("requires FIREBASE_PROJECT_ID", () => {
    expect(() =>
      parseEnvironment({ ADMIN_FIREBASE_UIDS: "admin-1" }),
    ).toThrow(/FIREBASE_PROJECT_ID/);
  });

  it("trims FIREBASE_PROJECT_ID", () => {
    expect(
      parseEnvironment({
        FIREBASE_PROJECT_ID: "  wedding-project  ",
        ADMIN_FIREBASE_UIDS: "admin-1",
      }).firebaseProjectId,
    ).toBe("wedding-project");
  });

  it("parses, trims and removes empty admin UIDs", () => {
    expect(
      parseEnvironment({
        ...REQUIRED_ENV,
        ADMIN_FIREBASE_UIDS: " admin-1, ,admin-2, ",
      }).adminFirebaseUids,
    ).toEqual(["admin-1", "admin-2"]);
  });

  it.each([undefined, "", " , "])(
    "rejects empty ADMIN_FIREBASE_UIDS",
    (ADMIN_FIREBASE_UIDS) => {
      expect(() =>
        parseEnvironment({
          FIREBASE_PROJECT_ID: "wedding-project",
          ADMIN_FIREBASE_UIDS,
        }),
      ).toThrow(/ADMIN_FIREBASE_UIDS/);
    },
  );

  it("parses, trims and removes empty CORS origins", () => {
    expect(
      parseEnvironment({
        ...REQUIRED_ENV,
        CORS_ALLOWED_ORIGINS:
          " http://localhost:5173, ,https://admin.example.com, ",
      }).corsAllowedOrigins,
    ).toEqual(["http://localhost:5173", "https://admin.example.com"]);
  });

  it.each([undefined, "", " , "])(
    "keeps CORS closed when origins are absent or empty",
    (CORS_ALLOWED_ORIGINS) => {
      expect(
        parseEnvironment({ ...REQUIRED_ENV, CORS_ALLOWED_ORIGINS })
          .corsAllowedOrigins,
      ).toEqual([]);
    },
  );

  it.each(["*", "https://example.com/path", "ftp://example.com"])(
    "rejects unsafe or invalid CORS origin %s",
    (CORS_ALLOWED_ORIGINS) => {
      expect(() =>
        parseEnvironment({ ...REQUIRED_ENV, CORS_ALLOWED_ORIGINS }),
      ).toThrow(/CORS_ALLOWED_ORIGINS/);
    },
  );
});
