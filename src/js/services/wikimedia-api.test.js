/* Contract tests for the Wikimedia Commons client — the second half of the
 * hybrid photo strategy (see photo-api.js). Unlike Pexels this is a public,
 * keyless API called directly from the browser, so there is no same-origin
 * proxy to test the contract of: these tests stub `fetch` itself and assert
 * on the request Commons actually receives and how its response is
 * re-projected, filtered by license, and degraded on failure. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { wikimediaGeosearch, wikimediaSearch } from "./wikimedia-api.js";

function stubFetch(impl) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  });
  return calls;
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/* A single Commons `query.pages` entry, generatorversion=2 shape (an array),
   with every field toCandidate() reads. Override individual fields per test. */
function commonsPage(overrides = {}) {
  return {
    title: "File:Eiffel Tower at dusk.jpg",
    coordinates: [{ lat: 48.8584, lon: 2.2945 }],
    imageinfo: [
      {
        thumburl: "https://upload.wikimedia.org/thumb/eiffel-1280.jpg",
        thumbwidth: 1280,
        thumbheight: 854,
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Eiffel_Tower_at_dusk.jpg",
        extmetadata: {
          LicenseShortName: { value: "CC BY-SA 4.0" },
          Artist: { value: '<a href="https://example.org/x">Jane Doe</a>' },
          ImageDescription: { value: "The Eiffel Tower photographed at dusk." },
        },
      },
    ],
    ...overrides,
  };
}

function commonsResponse(pages) {
  return { query: { pages } };
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("wikimediaGeosearch — coordinate-based lookup", () => {
  it("calls the official Commons API, keyless, over CORS with origin=*", async () => {
    const calls = stubFetch(() => jsonResponse(200, commonsResponse([])));
    await wikimediaGeosearch(48.8584, 2.2945);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.hostname).toBe("commons.wikimedia.org");
    expect(url.pathname).toBe("/w/api.php");
    expect(url.searchParams.get("origin")).toBe("*");
    expect(url.searchParams.get("generator")).toBe("geosearch");
    expect(url.searchParams.get("ggscoord")).toBe("48.8584|2.2945");
    /* no Authorization/API key — this endpoint is public by design */
    expect(JSON.stringify(calls[0].init.headers || {})).not.toMatch(/authorization/i);
    expect(calls[0].url).not.toMatch(/key=/i);
  });

  it("maps a page's imageinfo/coordinates/license onto the shared photo shape", async () => {
    stubFetch(() => jsonResponse(200, commonsResponse([commonsPage()])));
    const [photo] = await wikimediaGeosearch(48.8584, 2.2945);

    expect(photo).toMatchObject({
      src: "https://upload.wikimedia.org/thumb/eiffel-1280.jpg",
      photographer: "Jane Doe", // HTML stripped from the Artist field
      link: "https://commons.wikimedia.org/wiki/File:Eiffel_Tower_at_dusk.jpg",
      alt: "The Eiffel Tower photographed at dusk.",
      license: "CC BY-SA 4.0",
      source: "wikimedia",
      lat: 48.8584,
      lon: 2.2945,
      width: 1280,
      height: 854,
    });
  });

  it("resolves to an empty array for non-finite coordinates, without calling fetch", async () => {
    const calls = stubFetch(() => jsonResponse(200, commonsResponse([])));
    await expect(wikimediaGeosearch(NaN, 2.29)).resolves.toEqual([]);
    await expect(wikimediaGeosearch(48.85, undefined)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("applies a request timeout so a hanging endpoint cannot freeze the UI", async () => {
    const calls = stubFetch(() => jsonResponse(200, commonsResponse([])));
    await wikimediaGeosearch(48.8584, 2.2945);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("wikimediaSearch — text/category search", () => {
  it("issues a generator=search query with the given text", async () => {
    const calls = stubFetch(() => jsonResponse(200, commonsResponse([])));
    await wikimediaSearch("Reykjavik Iceland");

    const url = new URL(calls[0].url);
    expect(url.searchParams.get("generator")).toBe("search");
    expect(url.searchParams.get("gsrsearch")).toBe("Reykjavik Iceland");
    expect(url.searchParams.get("gsrnamespace")).toBe("6"); // File: namespace only
  });

  it("resolves to an empty array for an empty/whitespace query, without calling fetch", async () => {
    const calls = stubFetch(() => jsonResponse(200, commonsResponse([])));
    await expect(wikimediaSearch("")).resolves.toEqual([]);
    await expect(wikimediaSearch("   ")).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("returns multiple candidates for ranking, not just the first", async () => {
    stubFetch(() =>
      jsonResponse(
        200,
        commonsResponse([
          commonsPage({ title: "File:A.jpg" }),
          commonsPage({ title: "File:B.jpg" }),
        ]),
      ),
    );
    const results = await wikimediaSearch("Reykjavik Iceland");
    expect(results).toHaveLength(2);
  });
});

describe("license and attribution/metadata rejection", () => {
  const cases = [
    ["an unrecognised/unclear license string", { LicenseShortName: { value: "Copyrighted" } }],
    ["a missing license entirely", {}],
    ["an empty license value", { LicenseShortName: { value: "" } }],
  ];
  for (const [label, extmetadata] of cases) {
    it(`rejects ${label}`, async () => {
      stubFetch(() =>
        jsonResponse(
          200,
          commonsResponse([
            commonsPage({
              imageinfo: [
                {
                  ...commonsPage().imageinfo[0],
                  extmetadata: {
                    ...commonsPage().imageinfo[0].extmetadata,
                    LicenseShortName: undefined,
                    ...extmetadata,
                  },
                },
              ],
            }),
          ]),
        ),
      );
      await expect(wikimediaSearch("anywhere")).resolves.toEqual([]);
    });
  }

  it("accepts CC0, public domain, and versioned CC BY / CC BY-SA alike", async () => {
    const licenses = ["CC0", "Public domain", "CC BY 3.0", "CC BY-SA 2.0", "cc-by-sa-4.0"];
    for (const license of licenses) {
      stubFetch(() =>
        jsonResponse(
          200,
          commonsResponse([
            commonsPage({
              imageinfo: [
                {
                  ...commonsPage().imageinfo[0],
                  extmetadata: {
                    ...commonsPage().imageinfo[0].extmetadata,
                    LicenseShortName: { value: license },
                  },
                },
              ],
            }),
          ]),
        ),
      );
      const [photo] = await wikimediaSearch("anywhere");
      expect(photo?.license).toBe(license);
    }
  });

  it("rejects a result with no named photographer/artist — insufficient metadata", async () => {
    stubFetch(() =>
      jsonResponse(
        200,
        commonsResponse([
          commonsPage({
            imageinfo: [
              {
                ...commonsPage().imageinfo[0],
                extmetadata: { ...commonsPage().imageinfo[0].extmetadata, Artist: undefined },
              },
            ],
          }),
        ]),
      ),
    );
    await expect(wikimediaSearch("anywhere")).resolves.toEqual([]);
  });

  it("rejects a result with no non-https or missing description page link", async () => {
    stubFetch(() =>
      jsonResponse(
        200,
        commonsResponse([
          commonsPage({
            imageinfo: [
              { ...commonsPage().imageinfo[0], descriptionurl: "http://insecure.example/" },
            ],
          }),
        ]),
      ),
    );
    await expect(wikimediaSearch("anywhere")).resolves.toEqual([]);
  });

  it("rejects a result with no usable https thumbnail", async () => {
    stubFetch(() =>
      jsonResponse(
        200,
        commonsResponse([
          commonsPage({ imageinfo: [{ ...commonsPage().imageinfo[0], thumburl: "" }] }),
        ]),
      ),
    );
    await expect(wikimediaSearch("anywhere")).resolves.toEqual([]);
  });
});

describe("failure handling — Wikimedia unreachable or empty", () => {
  it("resolves to an empty array on a non-200 response", async () => {
    stubFetch(() => jsonResponse(502, { error: "bad gateway" }));
    await expect(wikimediaSearch("anywhere")).resolves.toEqual([]);
    await expect(wikimediaGeosearch(1, 1)).resolves.toEqual([]);
  });

  it("resolves to an empty array on a network failure or timeout, without throwing", async () => {
    stubFetch(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(wikimediaSearch("anywhere")).resolves.toEqual([]);
  });

  it("resolves to an empty array when Commons genuinely has nothing", async () => {
    stubFetch(() => jsonResponse(200, commonsResponse([])));
    await expect(wikimediaSearch("an extremely obscure place")).resolves.toEqual([]);
  });

  it("resolves to an empty array on malformed JSON, without throwing", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }));
    await expect(wikimediaSearch("anywhere")).resolves.toEqual([]);
  });
});
