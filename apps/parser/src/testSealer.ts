import { kmsSealer, type KmsClient, type Sealer } from "./sealing";

// A stand-in for Cloud KMS for the tests: the "ciphertext" carries the
// plaintext, the additional authenticated data and a counter (so sealing
// the same value twice differs, as KMS's random IV makes it), and
// decryption refuses data other than what it was sealed with.
export function fakeKms(): KmsClient & { calls: { encrypt: number; decrypt: number } } {
  const calls = { encrypt: 0, decrypt: 0 };
  let n = 0;
  return {
    calls,
    async encrypt(_keyName, plaintext, aad) {
      calls.encrypt += 1;
      return Buffer.from(JSON.stringify({ plaintext, aad, n: ++n })).toString("base64");
    },
    async decrypt(_keyName, ciphertext, aad) {
      calls.decrypt += 1;
      const sealed = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8")) as { plaintext: string; aad: string };
      if (sealed.aad !== aad) throw Object.assign(new Error("Decryption failed: additional authenticated data does not match"), { code: 400 });
      return sealed.plaintext;
    },
  };
}

export const testKeyName = "projects/demo/locations/global/keyRings/travelmo/cryptoKeys/credentials";

export function fakeSealer(): Sealer {
  return kmsSealer(testKeyName, fakeKms());
}
