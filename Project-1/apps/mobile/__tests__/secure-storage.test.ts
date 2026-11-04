import { createChunkedStorage, safeKey, type KeyValueBackend } from "../src/lib/secure-storage";

function memoryBackend() {
  const map = new Map<string, string>();
  const backend: KeyValueBackend = {
    getItemAsync: async (k) => map.get(k) ?? null,
    setItemAsync: async (k, v) => {
      if (v.length > 2048) throw new Error("SecureStore value too large");
      map.set(k, v);
    },
    deleteItemAsync: async (k) => void map.delete(k),
  };
  return { map, backend };
}

describe("chunked secure storage", () => {
  it("round-trips a session larger than the 2 KB SecureStore limit", async () => {
    const { backend } = memoryBackend();
    const s = createChunkedStorage(backend);
    const session = JSON.stringify({ access_token: "a".repeat(2500), refresh_token: "r".repeat(300), user: { id: "u" } });
    await s.setItem("sb-abc-auth-token", session);
    await expect(s.getItem("sb-abc-auth-token")).resolves.toBe(session);
  });

  it("replaces an old value without leaving stale chunks", async () => {
    const { map, backend } = memoryBackend();
    const s = createChunkedStorage(backend);
    await s.setItem("k", "x".repeat(6000));
    const before = map.size;
    await s.setItem("k", "short");
    expect(map.size).toBeLessThan(before);
    await expect(s.getItem("k")).resolves.toBe("short");
  });

  it("removes everything on sign-out", async () => {
    const { map, backend } = memoryBackend();
    const s = createChunkedStorage(backend);
    await s.setItem("k", "x".repeat(5000));
    await s.removeItem("k");
    expect(map.size).toBe(0);
    await expect(s.getItem("k")).resolves.toBeNull();
  });

  it("treats a torn write as signed out rather than using half a token", async () => {
    const { map, backend } = memoryBackend();
    const s = createChunkedStorage(backend);
    await s.setItem("k", "y".repeat(5000));
    map.delete("k.1");
    await expect(s.getItem("k")).resolves.toBeNull();
  });

  it("returns null for an unknown key and sanitises key names", async () => {
    const { backend } = memoryBackend();
    await expect(createChunkedStorage(backend).getItem("missing")).resolves.toBeNull();
    expect(safeKey("sb:abc/auth token")).toBe("sb_abc_auth_token");
  });
});