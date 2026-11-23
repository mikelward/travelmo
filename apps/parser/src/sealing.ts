import { mailboxKey, paths } from "@travelmo/core";
import { google } from "googleapis";

// Stored mail credentials (Gmail and Calendar refresh tokens, parked OAuth
// tokens, Fastmail API tokens) are sealed with a Cloud KMS key before they
// reach Firestore, so a leak or export of the database reveals nothing
// usable: only the parser's service account may decrypt them (SPEC "Stored
// credentials"). Each is sealed with a context naming the document and
// field it belongs in, as KMS's additional authenticated data, so a
// ciphertext copied into another user's document does not decrypt.

export type Sealer = {
  seal(plain: string, context: string): Promise<string>;
  open(stored: string, context: string): Promise<string>;
};

// What sealed values start with; anything else was stored before sealing
// and is read as it is until the migration seals it (sealStoredCredentials).
export const sealedPrefix = "kms1:";

export function isSealed(stored: string): boolean {
  return stored.startsWith(sealedPrefix);
}

// The two calls of the Cloud KMS API used here, everything base64.
export type KmsClient = {
  encrypt(keyName: string, plaintext: string, aad: string): Promise<string>;
  decrypt(keyName: string, ciphertext: string, aad: string): Promise<string>;
};

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

export function kmsSealer(keyName: string, client: KmsClient): Sealer {
  return {
    async seal(plain, context) {
      const ciphertext = await client.encrypt(keyName, base64(plain), base64(context));
      return sealedPrefix + ciphertext;
    },
    async open(stored, context) {
      if (!isSealed(stored)) return stored;
      const plaintext = await client.decrypt(keyName, stored.slice(sealedPrefix.length), base64(context));
      return Buffer.from(plaintext, "base64").toString("utf8");
    },
  };
}

// Without a key (local runs, tests): credentials are stored as they are.
// A sealed one cannot be read without the key, which is an error rather
// than a credential that silently stops working.
export const plainSealer: Sealer = {
  seal: async (plain) => plain,
  open: async (stored) => {
    if (isSealed(stored)) throw new Error("A stored credential is encrypted, but CREDENTIALS_KMS_KEY is not set");
    return stored;
  },
};

// The parser's own service account (application-default credentials),
// which needs roles/cloudkms.cryptoKeyEncrypterDecrypter on the key
// (deploy/kms.sh grants it).
export function googleKmsClient(): KmsClient {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloudkms"] });
  const keys = google.cloudkms({ version: "v1", auth }).projects.locations.keyRings.cryptoKeys;
  return {
    async encrypt(name, plaintext, additionalAuthenticatedData) {
      const res = await keys.encrypt({ name, requestBody: { plaintext, additionalAuthenticatedData } });
      if (!res.data.ciphertext) throw new Error("Cloud KMS returned no ciphertext");
      return res.data.ciphertext;
    },
    async decrypt(name, ciphertext, additionalAuthenticatedData) {
      const res = await keys.decrypt({ name, requestBody: { ciphertext, additionalAuthenticatedData } });
      // An empty plaintext comes back as none; no credential is empty.
      if (!res.data.plaintext) throw new Error("Cloud KMS returned no plaintext");
      return res.data.plaintext;
    },
  };
}

// The sealer every credential read and write goes through, chosen once as
// the parser starts (server.ts, from CREDENTIALS_KMS_KEY). Module state
// rather than a parameter: credentials are read in dozens of places, each
// of which would otherwise have to pass it on, and a forgotten one would
// store plaintext.
let current: Sealer = plainSealer;

export function useSealer(sealer: Sealer): void {
  current = sealer;
}

export function credentialSealer(): Sealer {
  return current;
}

// Where each credential is kept, as the context it is sealed with. A Gmail
// mailbox's is the document it is kept in by its address, which is also
// where one connected before there could be several moves to, so moving it
// keeps it readable.
export const credentialContext = {
  gmail: (uid: string, emailAddress: string) => `${paths.gmailMailbox(uid, mailboxKey(emailAddress))}#refreshToken`,
  calendar: (uid: string) => `${paths.googleCalendarState(uid)}#refreshToken`,
  pending: (token: string) => `${paths.pendingConnection(token)}#refreshToken`,
  fastmail: (uid: string) => `${paths.fastmailState(uid)}#token`,
};

// Opens a stored credential before the transaction that changes its
// document, so a KMS failure fails the change before anything is written
// rather than after (a reading marked running with no batch queued). The
// transaction then checks the credential is still the one opened, and the
// whole change is tried again if it was replaced meanwhile.
export async function withOpenedCredential<S, T>(
  read: () => Promise<S | undefined>,
  credentialOf: (state: S) => string,
  open: (state: S) => Promise<string>,
  transact: (unchanged: (state: S) => boolean) => Promise<{ state: S; rest: T } | "replaced" | undefined>,
): Promise<{ state: S; opened: string; rest: T } | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await read();
    const opened = before === undefined ? undefined : await open(before);
    const stored = before === undefined ? undefined : credentialOf(before);
    const result = await transact((state) => credentialOf(state) === stored);
    if (result === "replaced") continue;
    if (result === undefined) return undefined;
    return { state: result.state, opened: opened!, rest: result.rest };
  }
  throw new Error("A stored credential kept changing while it was read");
}
