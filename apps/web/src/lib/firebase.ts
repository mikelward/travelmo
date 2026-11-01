import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  type Firestore,
} from "firebase/firestore";

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}; copy apps/web/.env.example to .env.local`);
  return value;
}

// Initialized lazily so the static prerender never touches Firebase.
let app: FirebaseApp | undefined;
export function firebaseApp(): FirebaseApp {
  if (app) return app;
  app =
    getApps()[0] ??
    initializeApp({
      apiKey: requireEnv("NEXT_PUBLIC_FIREBASE_API_KEY", process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
      authDomain: requireEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
      projectId: requireEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
      appId: requireEnv("NEXT_PUBLIC_FIREBASE_APP_ID", process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    });
  return app;
}

let auth: Auth | undefined;
export function firebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(firebaseApp());
  const emulator = process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL;
  if (emulator) connectAuthEmulator(auth, emulator, { disableWarnings: true });
  return auth;
}

let db: Firestore | undefined;
// Off once this session could not clear another account's cache (below).
let persistent = true;

export function firestore(): Firestore {
  if (db) return db;
  // In the browser, documents already seen are kept in IndexedDB, so a trip
  // opened before still loads with no network (the service worker keeps the
  // page itself). Tabs share one cache. Firestore itself falls back to memory
  // where IndexedDB cannot be used.
  db =
    persistent && typeof window !== "undefined" && "indexedDB" in window
      ? initializeFirestore(firebaseApp(), {
          localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        })
      : getFirestore(firebaseApp());
  const emulator = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
  if (emulator) {
    const [host, port] = emulator.split(":");
    connectFirestoreEmulator(db, host ?? "localhost", Number(port ?? 8080));
  }
  return db;
}

const cacheOwnerKey = "travelmo.cacheOwner";

// The persistent cache belongs to the browser, not to an account, and the
// rules cannot reach it: a trip one user opened would otherwise be readable,
// offline, by another user signing in on the same browser. So when the
// account signing in is not the one whose documents the cache holds, the
// cache is cleared first. The same account signing in again keeps it.
//
// Whatever happens, the next firestore() call gets a fresh instance, since a
// terminated one answers nothing. If the cache could not be cleared, this
// session keeps its documents in memory only, so nothing of the previous
// account is read and nothing of this one is left behind, and the next load
// tries again.
export async function adoptFirestoreCache(uid: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(cacheOwnerKey) === uid) return;
  const instance = firestore();
  try {
    await terminate(instance);
    await clearIndexedDbPersistence(instance);
    localStorage.setItem(cacheOwnerKey, uid);
  } catch (error) {
    persistent = false;
    throw error;
  } finally {
    db = undefined;
  }
}
