/* Focused regression test for the device-location share-consent bug.
 *
 * Drives the REAL features/location.js#selectLocation() rather than poking
 * state.loc and emitting "location:selected" by hand, because the bug this
 * guards against is a timing race specific to that function's real shape:
 * state.loc changes synchronously, but "location:selected" does not fire
 * until fetchWeather() resolves — and a pan, view switch or layer change
 * landing in that gap must never see the new (already-current) state.loc
 * next to a share-consent flag left over from a previously shared, different
 * location. Bypassing the gap with a synchronous stand-in would make this
 * test pass on the buggy code too. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearBus, emit } from "../core/app-bus.js";
import { state } from "../core/state.js";

vi.mock("../core/i18n.js", () => ({ t: (key) => key }));
vi.mock("../ui/notifications.js", () => ({ showToast: vi.fn() }));
vi.mock("../ui/navigation.js", () => ({ switchView: vi.fn() }));
vi.mock("../ui/render-map.js", () => ({
  isMapPanelOpen: () => false,
  showMapPanel: vi.fn(),
  hideMapPanel: vi.fn(),
  renderMapInfo: vi.fn(),
  renderRecentLocations: vi.fn(),
}));
vi.mock("./map.js", () => ({
  getMapCamera: () => null,
  getMapOverlayState: () => ({ type: "none", offset: 0 }),
  setMapLayer: vi.fn(),
  jumpTo: vi.fn(),
  renderMap: vi.fn(),
}));
vi.mock("./map-click.js", () => ({ selectCoordinate: vi.fn() }));
vi.mock("./map-url.js", () => ({
  readUrlState: () => ({}),
  writeUrlState: vi.fn(),
  onUrlChange: vi.fn(),
  cancelPendingUrlState: vi.fn(),
  URL_REPLACE_DEBOUNCE_MS: 400,
}));

/* selectLocation()'s own dependencies — everything not central to the race
   being tested is stubbed out so this stays a fast, DOM-free unit test.
   ./recent-locations.js is deliberately left real: it's pure, DOM-free, and
   is itself the privacy contract (isDeviceLocation) map-url-sync.js relies on. */
vi.mock("./geolocation.js", () => ({ renderSidePos: vi.fn() }));
vi.mock("../services/photo-api.js", () => ({ bumpPhotoToken: vi.fn() }));
vi.mock("../ui/render-home.js", () => ({
  renderHeroSkeleton: vi.fn(),
  renderHero: vi.fn(),
  renderMetrics: vi.fn(),
  renderGroupedMetrics: vi.fn(),
  renderForecast: vi.fn(),
  renderChartTabs: vi.fn(),
  renderChart: vi.fn(),
  renderInsights: vi.fn(),
  renderHomeHourly: vi.fn(),
}));
vi.mock("../ui/render-advisory.js", () => ({
  renderAdvisory: vi.fn(),
  clearAdvisory: vi.fn(),
}));
vi.mock("../ui/render-forecast.js", () => ({
  renderHourly: vi.fn(),
  renderForecastPage: vi.fn(),
}));
const fetchWeather = vi.fn();
vi.mock("../services/weather-api.js", () => ({
  fetchWeather: (...args) => fetchWeather(...args),
  demoWeather: () => FAKE_WX,
}));

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { writeText: clipboardWriteText } },
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "window", {
  value: { location: { href: "http://localhost/#/map" } },
  configurable: true,
  writable: true,
});

const FAKE_WX = { current: { temp: 18, code: 1, isDay: true } };
const DEVICE_A = { id: "geo-me-1", lat: 48.8566, lon: 2.3522 };
const DEVICE_B = { id: "geo-me-2", lat: 43.6, lon: 1.44 };
const SEARCHED = { id: "city-tarbes", lat: 43.23, lon: 0.08 };

/* A resolvable handle on a single pending fetchWeather() call, so a test can
   assert on the state that exists WHILE weather is still loading. */
function deferredWeather() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  fetchWeather.mockImplementationOnce(() => promise);
  return { resolve: (wx = FAKE_WX) => resolve(wx) };
}

describe("map-url-sync share consent", () => {
  let writeUrlState;
  let sync;
  let shareMapView;
  let selectLocation;

  beforeEach(async () => {
    /* module state (shareConsent, state.loc) is intentionally NOT reset via
       vi.resetModules() between tests — that would give this file's `state`
       import a different instance than the one location.js/map-url-sync.js
       mutate internally. Instead every test begins by selecting a location,
       which the code under test resets consent on, so tests stay independent
       regardless of run order. */
    clearBus();
    vi.clearAllMocks();
    fetchWeather.mockResolvedValue(FAKE_WX);
    const urlModule = await import("./map-url.js");
    writeUrlState = urlModule.writeUrlState;
    const syncMod = await import("./map-url-sync.js");
    syncMod.initUrlSync();
    shareMapView = syncMod.shareMapView;
    ({ selectLocation } = await import("./location.js"));
    sync = () => writeUrlState.mock.calls.at(-1)?.[0];
  });

  it("does not include device coordinates before any share", async () => {
    await selectLocation(DEVICE_A);
    expect(sync().sel).toBeNull();
  });

  it("includes device coordinates only after Share is pressed", async () => {
    await selectLocation(DEVICE_A);
    await shareMapView();
    expect(sync().sel).toEqual({ lat: DEVICE_A.lat, lon: DEVICE_A.lon });
  });

  it("a normal searched location still shares without consent (unaffected)", async () => {
    await selectLocation(SEARCHED);
    expect(sync().sel).toEqual({ lat: SEARCHED.lat, lon: SEARCHED.lon });
  });

  it(
    "a device fix whose weather is still loading never leaks, even if a " +
      "pan or view change lands mid-load — and stays private once it settles",
    async () => {
      /* 1. select and share device location A */
      await selectLocation(DEVICE_A);
      await shareMapView();
      expect(sync().sel).toEqual({ lat: DEVICE_A.lat, lon: DEVICE_A.lon });

      /* 2. begin selecting device location B; its weather request is left
         unresolved on purpose */
      const weatherB = deferredWeather();
      const selecting = selectLocation(DEVICE_B);

      /* selectLocation() has already run synchronously up to its first
         await: state.loc is B, but "location:selected" has not fired yet */
      expect(state.loc).toBe(DEVICE_B);

      /* 3. a pan and a view change land while that request is still pending */
      emit("map:moved", { id: "worldMap", lat: DEVICE_B.lat, lon: DEVICE_B.lon, zoom: 9 });
      expect(sync().sel).toBeNull(); /* not A's stale consent published against B */
      emit("view:changed");
      expect(sync().sel).toBeNull();

      /* 4. resolve the request */
      weatherB.resolve();
      await selecting;

      /* 5. B remains private */
      expect(sync().sel).toBeNull();

      /* 6. Share publishes B, and only after this explicit press */
      await shareMapView();
      expect(sync().sel).toEqual({ lat: DEVICE_B.lat, lon: DEVICE_B.lon });
    },
  );

  it("a second device fix's weather resolving does not itself retroactively leak it", async () => {
    /* Same shape as above but checking the moment weather finishes loading,
       not just the moment it starts: settling must not implicitly restore
       whatever consent the previous location had. */
    await selectLocation(DEVICE_A);
    await shareMapView();

    const weatherB = deferredWeather();
    const selecting = selectLocation(DEVICE_B);
    weatherB.resolve();
    await selecting; /* "location:selected" fires here */
    expect(sync().sel).toBeNull();
  });
});
