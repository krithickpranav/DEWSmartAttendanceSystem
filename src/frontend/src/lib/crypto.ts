export async function hashSHA256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const APP_SECRET = "smart-attendance-v1-secret-key-2024";

/** Derive an AES-GCM key using a given salt (16-byte Uint8Array) */
async function deriveKeyWithSalt(salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(APP_SECRET),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Legacy key derivation (hardcoded salt) — only used for backward-compat decryption */
async function deriveKeyLegacy(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(APP_SECRET),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("attendance-salt"),
      iterations: 1000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

/**
 * New format: [16-byte random salt][12-byte IV][ciphertext]
 * Legacy format: [12-byte IV][ciphertext]
 */
const NEW_FORMAT_MARKER = 0xff; // first byte distinguishes new (>=16+12) from legacy
const SALT_SIZE = 16;
const IV_SIZE = 12;

export async function encryptEmbeddings(
  float32Array: Float32Array,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const key = await deriveKeyWithSalt(salt);
  const rawBuffer = float32Array.buffer.slice(0) as ArrayBuffer;
  const data = new Uint8Array(rawBuffer);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  // Format: [1-byte marker=0xff][16-byte salt][12-byte iv][ciphertext]
  const result = new Uint8Array(1 + SALT_SIZE + IV_SIZE + encrypted.byteLength);
  result[0] = NEW_FORMAT_MARKER;
  result.set(salt, 1);
  result.set(iv, 1 + SALT_SIZE);
  result.set(new Uint8Array(encrypted), 1 + SALT_SIZE + IV_SIZE);
  return result;
}

export async function decryptEmbeddings(
  encrypted: Uint8Array,
): Promise<Float32Array> {
  // Detect format: new format starts with 0xff and is long enough
  if (
    encrypted[0] === NEW_FORMAT_MARKER &&
    encrypted.length > 1 + SALT_SIZE + IV_SIZE
  ) {
    const salt = encrypted.slice(1, 1 + SALT_SIZE);
    const iv = encrypted.slice(1 + SALT_SIZE, 1 + SALT_SIZE + IV_SIZE);
    const data = encrypted.slice(1 + SALT_SIZE + IV_SIZE);
    const key = await deriveKeyWithSalt(salt);
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        data,
      );
      return new Float32Array(decrypted);
    } catch {
      // Fall through to legacy
    }
  }

  // Backward compatibility: try legacy format [12-byte IV][ciphertext]
  const key = await deriveKeyLegacy();
  const iv = encrypted.slice(0, IV_SIZE);
  const data = encrypted.slice(IV_SIZE);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return new Float32Array(decrypted);
}

/**
 * Compute HMAC-SHA256 of the encrypted bytes using the app secret.
 * Used to verify embedding integrity before use.
 */
export async function computeHMAC(data: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, data.buffer as ArrayBuffer);
  return new Uint8Array(sig);
}

export async function verifyHMAC(
  data: Uint8Array,
  expectedHmac: Uint8Array,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(APP_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      expectedHmac.buffer as ArrayBuffer,
      data.buffer as ArrayBuffer,
    );
  } catch {
    return false;
  }
}

export function embeddingToUint8Array(embedding: Float32Array): Uint8Array {
  return new Uint8Array(embedding.buffer);
}

export function uint8ArrayToEmbedding(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer);
}
