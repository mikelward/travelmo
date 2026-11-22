import { describe, expect, it } from "vitest";
import { trimLineEnds } from "./envTrim";

describe("trimLineEnds", () => {
  it("drops trailing line breaks and names what it changed", () => {
    const env: Record<string, string | undefined> = {
      GOOGLE_OAUTH_CLIENT_SECRET: "secret\n",
      GEMINI_API_KEY: "key\r\n",
      WEB_ORIGIN: "https://example.test",
      EMPTY: undefined,
    };
    expect(trimLineEnds(env)).toEqual(["GOOGLE_OAUTH_CLIENT_SECRET", "GEMINI_API_KEY"]);
    expect(env).toEqual({
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      GEMINI_API_KEY: "key",
      WEB_ORIGIN: "https://example.test",
      EMPTY: undefined,
    });
  });

  it("keeps line breaks inside a value", () => {
    const env: Record<string, string | undefined> = { KEY: "-----BEGIN-----\nabc\n-----END-----\n" };
    trimLineEnds(env);
    expect(env.KEY).toBe("-----BEGIN-----\nabc\n-----END-----");
  });
});
