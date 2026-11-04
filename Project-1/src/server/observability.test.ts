import { describe, expect, it } from "vitest";
import { describeRequestError } from "./observability";

const NOW = new Date("2026-11-04T10:00:00.000Z");

describe("describeRequestError", () => {
  it("records the route pattern, error class and digest", () => {
    const line = describeRequestError(Object.assign(new TypeError("boom"), { digest: "abc123" }), { method: "POST" }, { routePath: "/shop/[slug]", routeType: "render", renderSource: "react-server-components" }, NOW);
    expect(line).toEqual({
      level: "error",
      event: "request_error",
      time: "2026-11-04T10:00:00.000Z",
      digest: "abc123",
      error: "TypeError",
      method: "POST",
      route: "/shop/[slug]",
      route_type: "render",
      render_source: "react-server-components",
    });
  });

  it("never carries the error message, a URL, a query string or a phone number", () => {
    const err = Object.assign(new Error("duplicate key value (+919876543210) violates unique constraint"), { digest: "d1" });
    const text = JSON.stringify(describeRequestError(err, { method: "GET" }, { routePath: "/help-me-find-it/track", routeType: "render" }, NOW));
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain("duplicate key");
    expect(text).not.toContain("?phone");
  });

  it("survives odd input (non-error throws, missing context) without throwing", () => {
    expect(() => describeRequestError("a string was thrown", {}, {}, NOW)).not.toThrow();
    expect(() => describeRequestError(null, {}, {}, NOW)).not.toThrow();
    const line = describeRequestError(undefined, {}, {}, NOW);
    expect(line).toMatchObject({ error: "Error", method: "?", route: "?", digest: null });
  });

  it("neutralises control characters and caps lengths so a hostile value cannot forge extra log lines", () => {
    const line = describeRequestError({ name: "Evil\n{\"level\":\"info\"}", digest: "x".repeat(500) }, { method: "GET\r\n" }, { routePath: "/a\n/b" }, NOW);
    const text = JSON.stringify(line);
    expect(text).not.toMatch(/\\n|\\r/);
    expect(line.digest?.length).toBeLessThanOrEqual(64);
  });
});
