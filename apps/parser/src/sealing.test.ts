import {
  withOpenedCredential, credentialContext, isSealed, kmsSealer, plainSealer, sealedPrefix } from "./sealing";
import { fakeKms, testKeyName } from "./testSealer";

describe("kmsSealer", () => {
  const context = credentialContext.fastmail("u1");

  it("stores ciphertext under the kms1 prefix and opens it back", async () => {
    const sealer = kmsSealer(testKeyName, fakeKms());
    const stored = await sealer.seal("fmu1-secret", context);
    expect(stored.startsWith(sealedPrefix)).toBe(true);
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain("fmu1-secret");
    expect(await sealer.open(stored, context)).toBe("fmu1-secret");
  });

  it("keeps characters outside ASCII intact", async () => {
    const sealer = kmsSealer(testKeyName, fakeKms());
    expect(await sealer.open(await sealer.seal("pässwörd ✈", context), context)).toBe("pässwörd ✈");
  });

  it("refuses a ciphertext copied to another user's document", async () => {
    const sealer = kmsSealer(testKeyName, fakeKms());
    const stored = await sealer.seal("fmu1-secret", credentialContext.fastmail("u1"));
    await expect(sealer.open(stored, credentialContext.fastmail("u2"))).rejects.toThrow("additional authenticated data");
  });

  it("reads a credential stored before sealing as it is, without calling KMS", async () => {
    const kms = fakeKms();
    const sealer = kmsSealer(testKeyName, kms);
    expect(await sealer.open("1//plain-refresh-token", context)).toBe("1//plain-refresh-token");
    expect(kms.calls.decrypt).toBe(0);
  });

  it("binds a Gmail token to its mailbox, wherever the address is written", async () => {
    const sealer = kmsSealer(testKeyName, fakeKms());
    const stored = await sealer.seal("rt", credentialContext.gmail("u1", "Me@Example.com"));
    expect(await sealer.open(stored, credentialContext.gmail("u1", " me@example.com"))).toBe("rt");
    await expect(sealer.open(stored, credentialContext.gmail("u1", "other@example.com"))).rejects.toThrow();
  });
});

describe("plainSealer", () => {
  it("stores credentials as they are", async () => {
    expect(await plainSealer.seal("rt", "ctx")).toBe("rt");
    expect(await plainSealer.open("rt", "ctx")).toBe("rt");
  });

  it("refuses to pass off a sealed credential as plaintext", async () => {
    const stored = await kmsSealer(testKeyName, fakeKms()).seal("rt", "ctx");
    await expect(plainSealer.open(stored, "ctx")).rejects.toThrow("CREDENTIALS_KMS_KEY");
  });
});

describe("withOpenedCredential", () => {
  it("opens before the change, and starts over when the credential was replaced meanwhile", async () => {
    const stored = ["sealed-old", "sealed-new"];
    let reads = 0;
    let transactions = 0;
    const result = await withOpenedCredential(
      async () => ({ token: stored[Math.min(reads++, 1)]! }),
      (state) => state.token,
      async (state) => state.token.replace("sealed-", "open-"),
      async (unchanged) => {
        transactions += 1;
        // The transaction sees the new token from the start.
        const current = { token: "sealed-new" };
        return unchanged(current) ? { state: current, rest: "done" } : "replaced";
      },
    );
    expect(result).toEqual({ state: { token: "sealed-new" }, opened: "open-new", rest: "done" });
    expect(transactions).toBe(2);
  });

  it("writes nothing when the credential cannot be opened", async () => {
    let transactions = 0;
    await expect(
      withOpenedCredential(
        async () => ({ token: "sealed" }),
        (state) => state.token,
        async () => Promise.reject(new Error("Cloud KMS unavailable")),
        async () => {
          transactions += 1;
          return undefined;
        },
      ),
    ).rejects.toThrow("Cloud KMS unavailable");
    expect(transactions).toBe(0);
  });
});
