"use client";

import { paths, type UserProfile } from "@travelmo/core";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { recordSelf, useAccess, type Access } from "./access";
import { adoptFirestoreCache, firebaseAuth, firestore } from "./firebase";

type AuthState = {
  user: User | null | undefined;
  // Whether the signed-in account may use the app (SPEC "Access").
  access: Access;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

declare global {
  interface Window {
    travelmoTestSignIn?: (email: string) => Promise<string>;
  }
}

// Against the Auth emulator only: lets end-to-end tests sign in without
// Google's popup, with the fake Google credential the emulator accepts.
// Returns the uid so a test can seed data for that user.
function installTestSignIn(): (() => void) | undefined {
  if (!process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL) return undefined;
  window.travelmoTestSignIn = async (email) => {
    const token = JSON.stringify({ sub: email, email, email_verified: true, name: email.split("@")[0] });
    const { user } = await signInWithCredential(firebaseAuth(), GoogleAuthProvider.credential(token));
    return user.uid;
  };
  return () => {
    delete window.travelmoTestSignIn;
  };
}

async function saveProfile(user: User): Promise<void> {
  const profile: UserProfile = {
    ...(user.email ? { email: user.email.toLowerCase() } : {}),
    ...(user.displayName ? { displayName: user.displayName } : {}),
    ...(user.photoURL ? { photoURL: user.photoURL } : {}),
  };
  await setDoc(doc(firestore(), paths.user(user.uid)), profile, { merge: true });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth(), async (next) => {
      // Before anything reads Firestore for this account.
      if (next) {
        await adoptFirestoreCache(next.uid).catch((error) =>
          console.error("Clearing the local cache for a new account failed", error),
        );
      }
      setUser(next);
    });
  }, []);
  useEffect(installTestSignIn, []);

  const access = useAccess(user);
  const approved = access.state === "approved";
  // The rules refuse the user document to an account not yet approved.
  useEffect(() => {
    if (user && approved) saveProfile(user).catch((error) => console.error("Saving profile failed", error));
  }, [user, approved]);
  const email = user?.emailVerified && user.email ? user.email.toLowerCase() : undefined;
  const unrecorded = access.state === "approved" && access.hasProfile && !access.record && !!email;
  useEffect(() => {
    if (user && email && unrecorded) {
      recordSelf(firestore(), email, user.uid, new Date().toISOString()).catch((error) => console.error("Recording access failed", error));
    }
  }, [user, email, unrecorded]);

  const value: AuthState = {
    user,
    access,
    signIn: async () => {
      await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
    },
    signOut: () => firebaseSignOut(firebaseAuth()),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error("useAuth must be used inside AuthProvider");
  return state;
}
