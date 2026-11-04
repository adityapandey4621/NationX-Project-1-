import { ApiError, buildQuery, createApiClient } from "../src/lib/api";

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, meta: {} }), { status });
const fail = (code: string, message: string, status: number, details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details }, meta: {} }), { status });

function client(fetchImpl: jest.Mock, token: string | null = "tok", extra: Partial<Parameters<typeof createApiClient>[0]> = {}) {
  return createApiClient({ baseUrl: "https://api.test", getToken: async () => token, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 200, ...extra });
}

describe("buildQuery", () => {
  it("skips empty values and encodes the rest", () => {
    expect(buildQuery({ q: "rice & dal", a: undefined, b: null, c: "", d: 5 })).toBe("?q=rice+%26+dal&d=5");
    expect(buildQuery(undefined)).toBe("");
  });
});

describe("api client", () => {
  it("unwraps the success envelope and sends the bearer token", async () => {
    const f = jest.fn().mockImplementation(async () => ok({ hello: "world" }));
    await expect(client(f).get("/me")).resolves.toEqual({ hello: "world" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.test/api/v1/me");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("does not attach the token to anonymous requests or when signed out", async () => {
    const f = jest.fn().mockImplementation(async () => ok({}));
    await client(f).get("/taxonomy", { anonymous: true });
    await client(f, null).get("/me");
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(f.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it("sends JSON bodies with a content type, and multipart forms without one", async () => {
    const f = jest.fn().mockImplementation(async () => ok({}));
    await client(f).post("/x", { json: { a: 1 } });
    expect(f.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
    expect(f.mock.calls[0][1].body).toBe('{"a":1}');
    const form = new FormData();
    await client(f).post("/y", { form });
    expect(f.mock.calls[1][1].headers["Content-Type"]).toBeUndefined();
    expect(f.mock.calls[1][1].body).toBe(form);
  });

  it("maps server errors, keeping field details", async () => {
    const f = jest.fn().mockImplementation(async () => fail("VALIDATION_FAILED", "invalid", 400, [{ field: "price", message: "negative" }]));
    const e = await client(f).post("/x", { json: {} }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ code: "VALIDATION_FAILED", status: 400, retryable: false });
    expect((e as ApiError).fieldMessage("price")).toBe("negative");
  });

  it("treats unknown error codes as INTERNAL_ERROR", async () => {
    const f = jest.fn().mockImplementation(async () => fail("WEIRD", "x", 500));
    await expect(client(f).get("/x")).rejects.toMatchObject({ code: "INTERNAL_ERROR", retryable: true });
  });

  it("signals an expired session on 401 with a token, but not for anonymous callers", async () => {
    const f = jest.fn().mockImplementation(async () => fail("UNAUTHENTICATED", "no", 401));
    const onUnauthorized = jest.fn();
    await expect(client(f, "tok", { onUnauthorized }).get("/me")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(client(f, null, { onUnauthorized }).get("/me")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("reports connectivity failures as NETWORK and retries a GET once", async () => {
    const f = jest.fn().mockRejectedValueOnce(new TypeError("Network request failed")).mockImplementationOnce(async () => ok({ n: 1 }));
    await expect(client(f).get("/x")).resolves.toEqual({ n: 1 });
    expect(f).toHaveBeenCalledTimes(2);
    const g = jest.fn().mockRejectedValue(new TypeError("Network request failed"));
    await expect(client(g).get("/x")).rejects.toMatchObject({ code: "NETWORK", retryable: true });
    expect(g).toHaveBeenCalledTimes(2);
  });

  it("never silently retries a write", async () => {
    const f = jest.fn().mockRejectedValue(new TypeError("Network request failed"));
    await expect(client(f).post("/help-me-find-it", { json: {} })).rejects.toMatchObject({ code: "NETWORK" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("times out slow requests", async () => {
    const f = jest.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted")))));
    await expect(client(f as unknown as jest.Mock).post("/x", { json: {} })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("reports a non-envelope reply as a bad response", async () => {
    const f = jest.fn().mockImplementation(async () => new Response("<html>gateway</html>", { status: 502 }));
    await expect(client(f).post("/x", { json: {} })).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 502 });
    const g = jest.fn().mockImplementation(async () => new Response("nope", { status: 200 }));
    await expect(client(g).post("/x", { json: {} })).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});