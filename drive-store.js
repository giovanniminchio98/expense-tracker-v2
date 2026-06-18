// ---------------------------------------------------------------------------
// Google Drive "appDataFolder" storage.
//
// Instead of a database, we keep each user's expenses as a single JSON file in
// the hidden, app-private "Application Data" folder of THEIR Google Drive.
// Only this app can read/write that folder, and the data follows the user's
// Google account across devices. No backend, no DB.
//
// Docs: https://developers.google.com/drive/api/guides/appdata
// ---------------------------------------------------------------------------

const FILE_NAME = "expenses.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// The OAuth access token obtained at sign-in (see auth.js).
let accessToken = null;
// Cached id of the Drive file once we've found or created it.
let fileId = null;

export function setAccessToken(token) {
  accessToken = token;
  fileId = null; // force a re-lookup for the new session/user
}

export function hasAccessToken() {
  return Boolean(accessToken);
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${accessToken}`, ...extra };
}

// Thrown when the access token is missing/expired. The UI uses this to
// re-prompt the user to sign in.
export class AuthExpiredError extends Error {}
// Thrown on network failure / timeout (offline). The UI keeps local data.
export class NetworkError extends Error {}

async function request(url, options = {}) {
  if (!accessToken) throw new AuthExpiredError("No access token");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch(url, { ...options, headers: authHeaders(options.headers), signal: ctrl.signal });
  } catch (e) {
    throw new NetworkError(e?.name === "AbortError" ? "Drive request timed out" : "Network error");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    accessToken = null;
    throw new AuthExpiredError("Drive access token expired");
  }
  if (!res.ok) {
    throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  }
  return res;
}

// Locate the expenses file in the appDataFolder, if it exists.
async function findFile() {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${FILE_NAME}'`,
    fields: "files(id, name)",
    pageSize: "1",
  });
  const res = await request(`${DRIVE_API}/files?${params}`);
  const data = await res.json();
  return data.files && data.files.length ? data.files[0].id : null;
}

// Create the file in the appDataFolder with initial content.
async function createFile(content) {
  const boundary = "-------expensetracker" + Date.now();
  const metadata = { name: FILE_NAME, parents: ["appDataFolder"] };
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: application/json\r\n\r\n" +
    `${JSON.stringify(content)}\r\n` +
    `--${boundary}--`;

  const res = await request(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  const data = await res.json();
  return data.id;
}

// Public: load the saved document { expenses, deleted } for the current user.
// `deleted` is a map of id -> deletion timestamp (ms) used to merge safely.
export async function loadDoc() {
  fileId = await findFile();
  if (!fileId) return { expenses: [], deleted: {} };
  const res = await request(`${DRIVE_API}/files/${fileId}?alt=media`);
  try {
    const data = await res.json();
    return {
      expenses: Array.isArray(data.expenses) ? data.expenses : [],
      deleted: data.deleted && typeof data.deleted === "object" ? data.deleted : {},
    };
  } catch {
    return { expenses: [], deleted: {} };
  }
}

// Public: persist the full document for the current user.
export async function saveDoc(doc) {
  const content = { version: 2, expenses: doc.expenses || [], deleted: doc.deleted || {} };
  if (!fileId) {
    fileId = await findFile();
  }
  if (!fileId) {
    fileId = await createFile(content);
    return;
  }
  await request(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(content),
  });
}
