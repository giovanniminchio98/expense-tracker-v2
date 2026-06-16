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
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope(DRIVE_SCOPE);
// Always show the account chooser so users can switch accounts easily.
provider.setCustomParameters({ prompt: "select_account" });

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

// Subscribe to auth state. Note: on a page reload Firebase restores the user
// session, but NOT the Google OAuth access token — so the app will ask the
// user to re-authorize Drive access by signing in again.
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
