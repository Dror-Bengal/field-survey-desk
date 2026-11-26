// Auth surface used by the UI. Surveyors and admins both sign in with
// email + password (Firebase Auth handles the password store). Role is
// decided server-side by /me — the Firebase provider doesn't choose which
// app surface the user lands on.
//
// Registers with the API client at module load so every request() picks up
// the latest Firebase ID token automatically.

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

import { auth } from './firebase.js';
import { setAuthProvider } from './api.js';

export async function signInAdmin(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

// Email/password helpers for surveyors. No verification step — admin still
// gates account approval via the pending → active status transition.
export async function signUpWithEmail(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function signInWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export function signOutCurrent() {
  return signOut(auth);
}

export function subscribeAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

// Returns a Promise<string> when signed in, or null when signed out.
// `request()` does `await provider()`, which handles both cases cleanly.
export function getCurrentIdToken(forceRefresh = false) {
  return auth.currentUser?.getIdToken(forceRefresh) ?? null;
}

setAuthProvider(getCurrentIdToken);
