// ---------------------------------------------------------------------------
// Firebase Authentication with Google sign-in.
//
// We sign the user in with Google AND request the Drive "appdata" scope in the
// same popup, so the credential we get back carries an OAuth access token that
// can talk to the Drive API (see drive-store.js).
// ---------------------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Keep the user signed in across reopens/restarts until they explicitly sign
// out or clear the browser's storage.
setPersistence(auth, browserLocalPersistence).catch(() => {});

const provider = new GoogleAuthProvider();
provider.addScope(DRIVE_SCOPE);

// Returns { user, accessToken }. accessToken is the Google OAuth token used
// for Drive API calls.
export async function signIn() {
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  return { user: result.user, accessToken: credential?.accessToken ?? null };
}

export function logout() {
  return signOut(auth);
}

export function currentUser() {
  return auth.currentUser;
}

// Subscribe to auth state. Firebase restores the signed-in user across reopens,
// but NOT the short-lived Google OAuth access token — that is refreshed
// transparently the next time the app needs to sync (see app.js).
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
