import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

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
export function firestore(): Firestore {
  if (db) return db;
  db = getFirestore(firebaseApp());
  const emulator = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
  if (emulator) {
    const [host, port] = emulator.split(":");
    connectFirestoreEmulator(db, host ?? "localhost", Number(port ?? 8080));
  }
  return db;
}
