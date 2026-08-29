/* Connectivity status and service-worker registration.
 *
 * Registration is deliberately production-only, and every failure path is
 * silent — the worker is a progressive enhancement, so none of it may ever
 * throw into app boot. Those are the guarantees pinned here. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isOffline,
  bindOfflineStatus,
  registerServiceWorker,
  clearOfflineCaches,
} from "./offline.js";

/* Node 21+ ships a real, getter-only globalThis.navigator, so a plain
   assignment throws — every stub goes through defineProperty, and the
   original descriptor is put back afterwards. */
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

/* A minimal window that records its listeners, so the unsubscribe contract
   can be checked rather than assumed. */
function stubWindow() {
  const listeners = {};
  defineGlobal("window", {
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    __listeners: listeners,
  });
  return listeners;
}

function stubNavigator(props) {
  defineGlobal("navigator", props);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  restoreGlobal("navigator", originalNavigatorDescriptor);
  restoreGlobal("window", originalWindowDescriptor);
});

describe("isOffline", () => {
  it("is true only when the browser explicitly reports offline", () => {
    stubNavigator({ onLine: false });
    expect(isOffline()).toBe(true);
    stubNavigator({ onLine: true });
    expect(isOffline()).toBe(false);
  });

  it("assumes online when the browser has no opinion", () => {
    /* navigator.onLine is undefined in some embedded/webview contexts —
       defaulting to "offline" there would permanently mislabel live data */
    stubNavigator({});
    expect(isOffline()).toBe(false);
  });
});

describe("bindOfflineStatus", () => {
  it("reports the new state on both online and offline events", () => {
    const listeners = stubWindow();
    stubNavigator({ onLine: true });
    const seen = [];
    bindOfflineStatus((offline) => seen.push(offline));

    stubNavigator({ onLine: false });
    listeners.offline.forEach((fn) => fn());
    stubNavigator({ onLine: true });
    listeners.online.forEach((fn) => fn());

    expect(seen).toEqual([true, false]);
  });

  it("returns a working unsubscribe", () => {
    const listeners = stubWindow();
    stubNavigator({ onLine: true });
    const seen = [];
    const off = bindOfflineStatus((offline) => seen.push(offline));
    off();

    expect(listeners.online).toHaveLength(0);
    expect(listeners.offline).toHaveLength(0);
    expect(seen).toEqual([]);
  });

  it("is a harmless no-op with no window at all", () => {
    defineGlobal("window", undefined);
    expect(() => bindOfflineStatus(() => {})()).not.toThrow();
  });
});

describe("registerServiceWorker", () => {
  it("does nothing unless explicitly enabled — dev must never register", () => {
    const register = vi.fn();
    stubNavigator({ serviceWorker: { register } });
    return registerServiceWorker({ enabled: false }).then((result) => {
      expect(register).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  it("registers the root-scoped worker when enabled", async () => {
    const register = vi.fn(async () => "registration");
    stubNavigator({ serviceWorker: { register } });
    const result = await registerServiceWorker({ enabled: true, scope: "/" });
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(result).toBe("registration");
  });

  it("honours a subdirectory base so a non-root deploy still works", async () => {
    const register = vi.fn(async () => "ok");
    stubNavigator({ serviceWorker: { register } });
    await registerServiceWorker({ enabled: true, scope: "/site-meteo/" });
    expect(register).toHaveBeenCalledWith("/site-meteo/sw.js", { scope: "/site-meteo/" });
  });

  it("resolves null rather than throwing when the browser has no support", async () => {
    stubNavigator({});
    await expect(registerServiceWorker({ enabled: true })).resolves.toBeNull();
  });

  it("swallows a rejected registration — boot must never fail on it", async () => {
    stubNavigator({
      serviceWorker: {
        register: vi.fn(async () => {
          throw new Error("insecure context");
        }),
      },
    });
    await expect(registerServiceWorker({ enabled: true })).resolves.toBeNull();
  });
});

describe("clearOfflineCaches", () => {
  it("messages the active worker", () => {
    const postMessage = vi.fn();
    stubNavigator({ serviceWorker: { controller: { postMessage } } });
    clearOfflineCaches();
    expect(postMessage).toHaveBeenCalledWith("clear-caches");
  });

  it("is a no-op when nothing is controlling the page", () => {
    stubNavigator({ serviceWorker: { controller: null } });
    expect(() => clearOfflineCaches()).not.toThrow();
    stubNavigator({});
    expect(() => clearOfflineCaches()).not.toThrow();
  });
});
