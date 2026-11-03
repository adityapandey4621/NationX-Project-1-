/**
 * Supabase sessions (access + refresh token + user) exceed SecureStore's ~2 KB per-value limit, so the
 * session is split into chunks. Tokens live in the Android Keystore / iOS Keychain via expo-secure-store,
 * never in AsyncStorage or logs. The backend is injected so the logic is testable.
 */
export interface KeyValueBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const CHUNK = 1800;
const countKey = (k: string) => `${k}.n`;
const chunkKey = (k: string, i: number) => `${k}.${i}`;

// SecureStore keys may only contain letters, digits, ".", "-" and "_".
export const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, "_");

export function createChunkedStorage(backend: KeyValueBackend) {
  async function removeItem(rawKey: string) {
    const key = safeKey(rawKey);
    const n = Number((await backend.getItemAsync(countKey(key))) ?? 0);
    for (let i = 0; i < n; i++) await backend.deleteItemAsync(chunkKey(key, i));
    await backend.deleteItemAsync(countKey(key));
  }
  return {
    async getItem(rawKey: string): Promise<string | null> {
      const key = safeKey(rawKey);
      const n = Number((await backend.getItemAsync(countKey(key))) ?? 0);
      if (!Number.isInteger(n) || n <= 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await backend.getItemAsync(chunkKey(key, i));
        if (part === null) return null; // a torn write: treat as signed out rather than use half a token
        parts.push(part);
      }
      return parts.join("");
    },
    async setItem(rawKey: string, value: string): Promise<void> {
      const key = safeKey(rawKey);
      await removeItem(rawKey);
      const n = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < n; i++) await backend.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
      await backend.setItemAsync(countKey(key), String(n));
    },
    removeItem,
  };
}