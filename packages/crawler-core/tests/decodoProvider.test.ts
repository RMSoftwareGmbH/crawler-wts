import { describe, expect, it } from "vitest";
import { createDecodoProxyConfiguration } from "../src/proxy/decodoProvider.js";

describe("createDecodoProxyConfiguration", () => {
  it("maps host, port, username, password, and country into Playwright config", () => {
    expect(
      createDecodoProxyConfiguration({
        DECODO_PROXY_HOST: "gate.decodo.example",
        DECODO_PROXY_PORT: "10001",
        DECODO_PROXY_USERNAME: "fixture-user-{country}",
        DECODO_PROXY_PASSWORD: "fixture-password",
        DECODO_PROXY_COUNTRY: "us",
      }),
    ).toEqual({
      server: "http://gate.decodo.example:10001",
      username: "fixture-user-country-us",
      password: "fixture-password",
    });
  });

  it("omits optional credentials when not configured", () => {
    expect(
      createDecodoProxyConfiguration({
        DECODO_PROXY_HOST: "gate.decodo.example",
        DECODO_PROXY_PORT: "10001",
      }),
    ).toEqual({ server: "http://gate.decodo.example:10001" });
  });

  it.each(["0", "65536", "abc"])("rejects invalid proxy port %s", (port) => {
    expect(() =>
      createDecodoProxyConfiguration({
        DECODO_PROXY_HOST: "gate.decodo.example",
        DECODO_PROXY_PORT: port,
      }),
    ).toThrowError();
  });

  it("rejects missing country for a username template", () => {
    expect(() =>
      createDecodoProxyConfiguration({
        DECODO_PROXY_HOST: "gate.decodo.example",
        DECODO_PROXY_PORT: "10001",
        DECODO_PROXY_USERNAME: "fixture-user-{country}",
      }),
    ).toThrowError();
  });

  it("rejects malformed hosts and country codes", () => {
    expect(() =>
      createDecodoProxyConfiguration({
        DECODO_PROXY_HOST: "https://gate.decodo.example/path",
        DECODO_PROXY_PORT: "10001",
      }),
    ).toThrowError();
    expect(() =>
      createDecodoProxyConfiguration({
        DECODO_PROXY_HOST: "gate.decodo.example",
        DECODO_PROXY_PORT: "10001",
        DECODO_PROXY_COUNTRY: "us:extra",
      }),
    ).toThrowError();
  });
});
