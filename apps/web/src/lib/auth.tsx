"use client";

import { paths, type UserProfile } from "@travelmo/core";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { firebaseAuth, firestore } from "./firebase";

type AuthState = {
  user: User | null | undefined;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

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
    return onAuthStateChanged(firebaseAuth(), (next) => {
      setUser(next);
      if (next) saveProfile(next).catch((error) => console.error("Saving profile failed", error));
    });
  }, []);

  const value: AuthState = {
    user,
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
