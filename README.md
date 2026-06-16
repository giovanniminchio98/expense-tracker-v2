# Expense Tracker v2

A simple, **serverless** expense tracker.

- **Login:** Google sign-in via Firebase Authentication.
- **Storage:** Each user's expenses are saved as a JSON file in the hidden
  `appDataFolder` of **their own Google Drive** — no database, no backend.
  The data follows the user's Google account across devices, and only this app
  can see that file.

It's a plain static site (HTML + CSS + ES modules), so there is no build step.

---

## How the "save to the Google account" part works

Instead of a database we use the [Google Drive **Application Data folder**](https://developers.google.com/drive/api/guides/appdata):
a hidden, per-app folder inside the signed-in user's Drive.

1. At sign-in we ask Google for the `drive.appdata` scope.
2. Firebase returns an OAuth access token alongside the user.
3. We use that token to read/write `expenses.json` in the user's appDataFolder
   via the Drive REST API (see `public/drive-store.js`).

No server and no database are involved — everything runs in the browser and the
data lives in the user's Drive.

> Note: the Drive access token from the sign-in popup is short-lived (~1 hour)
> and is not restored on page reload, so the app asks the user to sign in again
> to re-authorize Drive when needed.

---

## What you need to create on Firebase / Google Cloud

Follow these steps once:

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com/> → **Add project**.
2. Give it a name (e.g. `expense-tracker-v2`). Google Analytics is optional.

### 2. Register a Web app
1. In the project, click the **Web** icon (`</>`) under **Get started by adding
   an app**.
2. Give it a nickname. You do **not** need Firebase Hosting checked here (you
   can add it later).
3. Copy the `firebaseConfig` object it shows you.

### 3. Paste the config into the app
Open [`public/firebase-config.js`](public/firebase-config.js) and replace the
placeholder values with the config from step 2. (These values are not secret —
they're meant to ship in client code.)

### 4. Enable Google sign-in
1. Firebase Console → **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Add new provider → Google → Enable** → set a
   support email → **Save**.

### 5. Enable the Google Drive API
The appDataFolder uses the Drive API, which lives in Google Cloud (your Firebase
project is also a Google Cloud project).
1. Go to <https://console.cloud.google.com/> and select the **same project**.
2. **APIs & Services → Library** → search **"Google Drive API"** → **Enable**.

### 6. Configure the OAuth consent screen
1. Google Cloud Console → **APIs & Services → OAuth consent screen**.
2. User type **External** → fill in app name, support email, developer email.
3. **Scopes:** add `.../auth/drive.appdata` (it's a sensitive scope).
4. While the app is in **Testing**, add your Google account(s) under
   **Test users**. (Publish the app later to allow anyone.)

### 7. Authorize your domains
Firebase Console → **Authentication → Settings → Authorized domains**. Make sure
the domain(s) you serve the app from are listed:
- `localhost` (already there by default, for local testing)
- your Firebase Hosting domain, e.g. `your-project.web.app` (added automatically
  when you deploy)
- any custom domain you use.

---

## Run it locally

Because it uses ES modules, open it through a local web server (not `file://`):

```bash
# any static server works, e.g.:
npx serve public
# then open the printed http://localhost:xxxx URL
```

`localhost` is an authorized domain by default, so Google sign-in works locally.

## Deploy (optional, Firebase Hosting)

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # pick your project
firebase deploy --only hosting
```

This serves the `public/` folder. After deploying, confirm the
`*.web.app` domain is in the Authorized domains list (step 7).

---

## Project layout

```
public/
  index.html          UI
  styles.css          styling
  app.js              main app logic (render, add/delete, sync)
  auth.js             Firebase Google sign-in (+ Drive scope)
  drive-store.js      read/write expenses.json in Drive appDataFolder
  firebase-config.js  <-- paste your Firebase config here
firebase.json         Firebase Hosting config
```
