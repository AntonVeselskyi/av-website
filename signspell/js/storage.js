import { normalizeProject } from "./shared.js";

const DB_NAME = "sign-spell";
const DB_VERSION = 1;
const STORE = "state";
const PROJECT_KEY = "current-project";
const CALIBRATION_KEY = "calibration-profile";
const FALLBACK_PREFIX = "sign-spell:";

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function openDb() {
  if (!("indexedDB" in globalThis)) return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getValue(key) {
  try {
    const db = await openDb();
    if (db) {
      const transaction = db.transaction(STORE, "readonly");
      return await requestToPromise(transaction.objectStore(STORE).get(key));
    }
  } catch (error) {
    console.warn("IndexedDB read failed; using localStorage", error);
  }
  try {
    const raw = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

async function setValue(key, value) {
  try {
    const db = await openDb();
    if (db) {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(value, key);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      return;
    }
  } catch (error) {
    console.warn("IndexedDB write failed; using localStorage", error);
  }
  localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(value));
}

export async function loadProject() {
  return normalizeProject(await getValue(PROJECT_KEY));
}

export async function saveProject(project) {
  const normalized = normalizeProject({ ...project, savedAt: Date.now() });
  await setValue(PROJECT_KEY, normalized);
  return normalized;
}

export async function loadCalibration() {
  return (await getValue(CALIBRATION_KEY)) || null;
}

export async function saveCalibration(profile) {
  if (!profile || typeof profile !== "object") throw new TypeError("Calibration profile must be an object");
  const safeProfile = { ...profile, savedAt: Date.now(), containsCameraFrames: false };
  await setValue(CALIBRATION_KEY, safeProfile);
  return safeProfile;
}

export function createAutosaver(save, delay = 450) {
  let timeout = 0;
  let pending;
  return (value) => {
    pending = value;
    clearTimeout(timeout);
    timeout = setTimeout(() => save(pending), delay);
  };
}
