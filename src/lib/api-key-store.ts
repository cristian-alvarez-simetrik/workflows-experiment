/**
 * Encrypted-at-rest storage for the OpenAI API key.
 *
 * A non-extractable AES-GCM CryptoKey lives in a dedicated IndexedDB database
 * (structured clone stores CryptoKey objects natively), and the API key is
 * stored next to it as { iv, ciphertext }. This keeps the key out of
 * localStorage/plaintext inspection; an attacker with in-page script access
 * can still use it, which is inherent to any browser-only app.
 */

const DB_NAME = "workflow-studio-secrets";
const STORE = "kv";
const CRYPTO_KEY_ID = "aes-key";
const API_KEY_ID = "openai-key";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function getCryptoKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(CRYPTO_KEY_ID);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-extractable: usable for encrypt/decrypt but never exportable
    ["encrypt", "decrypt"]
  );
  await idbPut(CRYPTO_KEY_ID, key);
  return key;
}

export async function saveApiKey(plaintext: string): Promise<void> {
  const key = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  await idbPut(API_KEY_ID, { iv, ciphertext: new Uint8Array(ciphertext) });
}

export async function loadApiKey(): Promise<string | null> {
  const record = await idbGet<{ iv: Uint8Array; ciphertext: Uint8Array }>(
    API_KEY_ID
  );
  if (!record) return null;
  try {
    const key = await getCryptoKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv as BufferSource },
      key,
      record.ciphertext as BufferSource
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

export async function forgetApiKey(): Promise<void> {
  await idbDelete(API_KEY_ID);
}

export async function hasApiKey(): Promise<boolean> {
  return (await idbGet(API_KEY_ID)) != null;
}

/* --- model preference (not a secret) --- */

const MODEL_KEY = "workflow-studio:ai-model";

export const AI_MODELS = [
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "gpt-5.1", label: "GPT-5.1" },
] as const;

export const DEFAULT_MODEL = "gpt-5.6-terra";

export function getStoredModel(): string {
  const stored = localStorage.getItem(MODEL_KEY);
  // Stored preferences may point at retired models — fall back to the default.
  if (stored && AI_MODELS.some((m) => m.id === stored)) return stored;
  return DEFAULT_MODEL;
}

export function setStoredModel(model: string): void {
  localStorage.setItem(MODEL_KEY, model);
}
