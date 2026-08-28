/* Regression coverage for the global flag-sizing fix: every flag context
 * sizes by a fixed HEIGHT with automatic width (never a fixed width, which
 * squashes a wide flag's rendered height relative to a narrower one) and
 * uses object-fit: contain (never cover/fill, which crop or stretch). See
 * src/styles/components/flags.css's .flag rule and the .location-flag-wrap
 * system it mirrors.
 *
 * This is a static-source check (no layout engine in vitest/jsdom), so it
 * greps the CSS text for the invariant rather than measuring boxes — the
 * Playwright suite (e2e/app.spec.js, "flag sizing consistency") verifies the
 * same contract against real rendered pixels for USA/France/Japan/Texas/
 * California/New York.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { COUNTRY_FLAG_CODES } from "./country-flag-codes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = join(HERE, "../../styles");
const FLAGS_DIR = join(HERE, "../../../public/assets/flags");
const COUNTRIES_DIR = join(FLAGS_DIR, "countries");

const flagsCss = readFileSync(join(STYLES, "components/flags.css"), "utf8");
const mapCss = readFileSync(join(STYLES, "views/map.css"), "utf8");
const favoritesCss = readFileSync(join(STYLES, "views/favorites.css"), "utf8");
const settingsCss = readFileSync(join(STYLES, "views/settings.css"), "utf8");

/* Pulls the declaration block for the first `selector { ... }` match, so
 * assertions read the actual rule body rather than pattern-matching loose
 * text across the whole file. */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`rule not found: ${selector}`);
  return m[1];
}

describe(".flag: height-based sizing, never width-based", () => {
  it("the base .flag rule fixes height and lets width flow automatically", () => {
    const body = ruleBody(flagsCss, ".flag");
    expect(body).toMatch(/height:\s*\d/);
    expect(body).toMatch(/width:\s*auto/);
    expect(body).not.toMatch(/width:\s*\d/);
    expect(body).toMatch(/object-fit:\s*contain/);
  });

  /* Every per-context override that sizes a country flag glyph — hero
   * identity, search results, Explore cards, the language switcher, the big
   * hero-landmark watermark — must size by height only. A stray fixed width
   * here is exactly the bug that made the (4:3) US flag read differently
   * from a (non-4:3) state flag shown elsewhere at "the same" size. */
  const heightOnlyContexts = [
    [".hero-loc-kicker .flag", flagsCss],
    [".hero-region .flag", flagsCss],
    [".si-visual .flag", flagsCss],
    [".explore-emoji .flag", flagsCss],
    [".explore-country .flag", flagsCss],
    [".hero-landmark .flag", flagsCss],
    [".favx-emoji .flag", favoritesCss],
    [".favx-top .flag", favoritesCss],
    [".ft-visual .flag", favoritesCss],
    [".set-tile .flag", settingsCss],
    [".info-visual .flag", mapCss],
    [".info-name .flag", mapCss],
    [".pop-row .flag", mapCss],
    [".map-popup .mp-name .flag", mapCss],
  ];
  it.each(heightOnlyContexts)("%s sizes by height, not width", (selector, css) => {
    const body = ruleBody(css, selector);
    expect(body).toMatch(/height:\s*\d/);
    expect(body).not.toMatch(/width:\s*\d/);
  });

  it("the .flag/.seg-toggle language-switcher flags size by height, not width", () => {
    const re = /\.menu \.flag,\s*\n?\s*\.seg-toggle \.flag\s*\{([^}]*)\}/;
    const m = flagsCss.match(re);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/height:\s*\d/);
    expect(m[1]).not.toMatch(/width:\s*\d/);
  });
});

describe(".location-flag-wrap: the shared country+region system", () => {
  it("forces every nested flag to the wrapper's height, auto width, contain — never stretched/cropped", () => {
    const m = flagsCss.match(/\.location-flag-wrap img,\s*\.location-flag-wrap > \.flag\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/height:\s*100%\s*!important/);
    expect(m[1]).toMatch(/width:\s*auto\s*!important/);
    expect(m[1]).toMatch(/object-fit:\s*contain/);
    expect(m[1]).not.toMatch(/object-fit:\s*(cover|fill)/);
  });
});

describe(".geo-chip-flag: map weather panel / geo-identity chips (img.flag-img.geo-chip-flag)", () => {
  it("sizes by height, auto width, object-fit: contain — never a fixed width, never cover/fill", () => {
    const body = ruleBody(mapCss, ".geo-chip-flag");
    expect(body).toMatch(/height:\s*\d/);
    expect(body).toMatch(/width:\s*auto/);
    /* negative lookbehind excludes `max-width:` — only a bare `width:` (not
       "auto") would re-introduce a fixed-width crop/stretch box */
    expect(body).not.toMatch(/(?<![a-z-])width:\s*(?!auto)\S/i);
    expect(body).toMatch(/object-fit:\s*contain/);
    expect(body).not.toMatch(/object-fit:\s*(cover|fill)/);
    /* max-width: none — nothing clamps the natural width back down once
       object-fit has already sized it correctly from the height */
    expect(body).toMatch(/max-width:\s*none/);
  });

  it("is the only rule for this selector — no later override in map.css re-adds cropping/stretching", () => {
    const matches = mapCss.match(/\.geo-chip-flag\s*\{/g) || [];
    expect(matches).toHaveLength(1);
  });
});

describe("no flag context crops (object-fit: cover) or stretches (object-fit: fill)", () => {
  it("the country-filter-chip icon box contains its flag instead of cropping it", () => {
    const m = mapCss.match(/\.chip-icon img,\s*\.chip-icon \.flag\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/object-fit:\s*contain/);
    expect(m[1]).not.toMatch(/object-fit:\s*cover/);
  });

  it("the popular-place card no longer force-stretches its flag pair to a fixed 4:3 box", () => {
    /* regression guard for the `.map-popular-place .flag { width: 20px;
       height: 15px; object-fit: fill; }` bug: that whole override is gone,
       so sizing falls through to .location-flag-wrap's own height + auto
       width + contain. */
    expect(mapCss).not.toMatch(/\.map-popular-place \.flag\s*\{/);
  });

  it("no stylesheet applies object-fit: fill to any flag element", () => {
    for (const css of [flagsCss, mapCss, favoritesCss, settingsCss]) {
      expect(css).not.toMatch(/object-fit:\s*fill/);
    }
  });
});

/* Intrinsic aspect ratio of each SVG, read straight from its own root <svg>
 * tag's viewBox (or width/height attributes when there's no viewBox) — the
 * same ratio the browser uses to lay it out, independent of any CSS in this
 * repo. Scoped to the ROOT tag specifically (not just "the first viewBox/
 * width/height found anywhere in the file"): several of the Wikimedia
 * Commons-sourced assets are Inkscape exports with nested elements that also
 * carry their own width/height attributes (e.g. an embedded raster preview),
 * and a document-wide regex would silently pair the root's width with some
 * unrelated nested element's height. */
function rootSvgTag(svg) {
  const m = svg.match(/<svg\b[^>]*>/);
  return m ? m[0] : "";
}

function intrinsicRatio(relPath) {
  const abs = join(FLAGS_DIR, relPath);
  expect(existsSync(abs), `missing asset: ${relPath}`).toBe(true);
  const svg = readFileSync(abs, "utf8");
  const root = rootSvgTag(svg);
  const vb = root.match(/viewBox="[^"]*?(-?[\d.]+)\s+(-?[\d.]+)"/);
  if (vb) return Number(vb[1]) / Number(vb[2]);
  const w = root.match(/[\s:]width="(\d+(?:\.\d+)?)(?:px)?"/);
  const h = root.match(/[\s:]height="(\d+(?:\.\d+)?)(?:px)?"/);
  expect(w && h, `no viewBox or width/height on root <svg> of ${relPath}`).toBeTruthy();
  return Number(w[1]) / Number(h[1]);
}

describe("intrinsic flag ratios: USA, France, Japan, Canada use their own authentic ratio, not a shared fake 4:3 canvas", () => {
  /* flag-icons' stock "4x3" set (still used for every other country in this
   * repo) force-fits EVERY flag into a 640x480 (4:3) canvas by stretching or
   * squashing its artwork to match — which is exactly why the US flag read
   * as too short/stubby next to a correctly-proportioned state flag even
   * after height-based sizing was fixed: its own source ratio was wrong.
   * These four assets were redrawn at their real, official ratio (stripes/
   * canton/stars, tricolor bands, sun disc and maple-leaf panel recomputed
   * or repositioned for the correct canvas — never non-uniformly scaled) so
   * the artwork itself, not just the CSS box around it, is authentic. */
  it("USA is 1.9:1 (10:19), per the 1959 executive-order proportions — not 4:3", () => {
    const us = intrinsicRatio("countries/us.svg");
    expect(us).toBeCloseTo(1.9, 2);
    expect(Math.abs(us - 4 / 3)).toBeGreaterThan(0.1);
  });

  it("France is 3:2 (equal vertical thirds) — not 4:3", () => {
    const fr = intrinsicRatio("countries/fr.svg");
    expect(fr).toBeCloseTo(1.5, 2);
    expect(Math.abs(fr - 4 / 3)).toBeGreaterThan(0.1);
  });

  it("Japan is 3:2, per the 1999 Act on National Flag and Anthem — not 4:3", () => {
    const jp = intrinsicRatio("countries/jp.svg");
    expect(jp).toBeCloseTo(1.5, 2);
    expect(Math.abs(jp - 4 / 3)).toBeGreaterThan(0.1);
  });

  it("Canada is 2:1, with a true square central panel for the maple leaf — not 4:3", () => {
    const ca = intrinsicRatio("countries/ca.svg");
    expect(ca).toBeCloseTo(2, 2);
    expect(Math.abs(ca - 4 / 3)).toBeGreaterThan(0.1);
  });

  it("US state flags still differ from the (now-authentic) US country ratio — height-based sizing is still required, not a fixed width", () => {
    const countryRatio = intrinsicRatio("countries/us.svg");
    const texas = intrinsicRatio("us-states/texas.svg");
    const california = intrinsicRatio("us-states/california.svg");
    const newYork = intrinsicRatio("us-states/new-york.svg");
    /* Texas/California are 3:2, New York is 2:1 — none matches the US
       country flag's own 1.9:1 */
    for (const r of [texas, california, newYork]) {
      expect(Math.abs(r - countryRatio)).toBeGreaterThan(0.05);
    }
    /* and none of them is an accidentally-square/placeholder asset */
    for (const r of [texas, california, newYork]) {
      expect(Math.abs(r - 1)).toBeGreaterThan(0.1);
    }
  });
});

/* All 271 files in countries/ were audited. 255 ordinary ISO-3166 codes plus
 * gb-eng/gb-nir/gb-sct/gb-wls/xk/eu (already correctly-ratioed in the source
 * below) were replaced wholesale with the matching file from
 * hampusborgos/country-flags (public domain, sourced from and verified
 * against Wikimedia Commons — see countries/SOURCES.md). 12 more non-ISO
 * codes with no match there were replaced individually with a specific,
 * verified-free Wikimedia Commons file (also listed in SOURCES.md). One
 * (cp — Clipperton Island) has no flag of its own and by documented
 * convention uses France's, so it was redrawn to match fr.svg exactly.
 * Two (asean, pc) could not be verified against any freely-licensed
 * authentic source and were deliberately left unfixed — see SOURCES.md and
 * the "known, tracked limitations" block below. */
describe("a broad sample of country flags carry their own real, documented ratio", () => {
  it.each([
    ["arab", 2, 0.05], // Arab League — Commons: Flag_of_the_Arab_League.svg
    ["un", 1.5, 0.01], // United Nations — 3:2
    ["dg", 2, 0.01], // BIOT — British-ensign convention, 1:2
    ["sh-hl", 2, 0.01], // Saint Helena — 1:2
    ["sh-ta", 2, 0.01], // Tristan da Cunha — 1:2
    ["sh-ac", 2, 0.01], // Ascension Island — 1:2
    ["es-ct", 1.5, 0.01], // Catalonia — 3:2
    ["es-ga", 1.5, 0.01], // Galicia — 3:2
    ["ic", 1.5, 0.01], // Canary Islands — 3:2
    ["es-pv", 25 / 14, 0.01], // Basque Country
    ["eac", 600 / 330, 0.01], // East African Community
    ["cefta", 652 / 446, 0.01], // CEFTA
    ["cp", 1.5, 0.01], // Clipperton — uses France's flag, 3:2
    ["de", 5 / 3, 0.01],
    ["ch", 1, 0.01], // Switzerland — square
    ["va", 1, 0.01], // Vatican — square
    ["np", 0.8203, 0.01], // Nepal — unique non-4:3 double pennant
    ["br", 10 / 7, 0.01], // Brazil
    ["mx", 7 / 4, 0.01], // Mexico
    ["dk", 37 / 28, 0.02], // Denmark
    ["au", 2, 0.01], // Australia
  ])("%s is ~%s (not forced to 4:3 unless that IS its real ratio)", (code, expected, tolerance) => {
    const ratio = intrinsicRatio(`countries/${code}.svg`);
    expect(Math.abs(ratio - expected)).toBeLessThan(tolerance);
  });

  it("Qatar keeps its distinctive ~11:28 serrated ratio (2.5+, the most elongated common flag)", () => {
    const qa = intrinsicRatio("countries/qa.svg");
    expect(qa).toBeGreaterThan(2.4);
    expect(qa).toBeLessThan(2.7);
  });

  it("DR Congo, Gabon, Papua New Guinea and San Marino are genuinely 3:4 — real ratios, not the old forced box", () => {
    /* These four really do use a 3:4 (portrait-leaning, ~1.333 landscape)
       ratio by law — the old bug forced literally every country here, so
       this is the one case where "still 1.333" is correct, not a
       regression. Distinguished from the bug by the sample above: the vast
       majority of countries are demonstrably NOT 1.333. */
    for (const code of ["cd", "ga", "pg", "sm"]) {
      const r = intrinsicRatio(`countries/${code}.svg`);
      expect(Math.abs(r - 4 / 3)).toBeLessThan(0.01);
    }
  });
});

describe("known, tracked limitations (see countries/SOURCES.md) — not silently \"fixed\"", () => {
  it("asean.svg and pc.svg are still the old flag-icons 4:3 artwork — no verified free source was found", () => {
    /* This test intentionally asserts the CURRENT, unfixed state. If it
       starts failing, it means someone replaced one of these two with a
       verified authentic-ratio asset — update this test (and SOURCES.md) to
       reflect the fix instead of reverting it. */
    for (const code of ["asean", "pc"]) {
      const r = intrinsicRatio(`countries/${code}.svg`);
      expect(Math.abs(r - 4 / 3)).toBeLessThan(0.01);
    }
  });

  it("xx.svg (flag-icons' generic 'unknown flag' glyph) is not a real flag and is never assigned to a location", async () => {
    const { LOCATIONS } = await import("./locations.js");
    const allCcs = new Set(LOCATIONS.map((loc) => loc.cc?.toLowerCase()).filter(Boolean));
    expect(allCcs.has("xx")).toBe(false);
  });
});

describe("full inventory: every country flag asset is well-formed and has a resolvable ratio", () => {
  const files = readdirSync(COUNTRIES_DIR).filter((f) => f.endsWith(".svg"));

  it("has exactly one file per code in the COUNTRY_FLAG_CODES manifest — nothing missing, nothing orphaned", () => {
    const fileCodes = new Set(files.map((f) => f.replace(/\.svg$/, "")));
    const manifestCodes = new Set(COUNTRY_FLAG_CODES);
    for (const code of manifestCodes) {
      expect(fileCodes.has(code), `manifest lists "${code}" but countries/${code}.svg is missing`).toBe(true);
    }
    for (const code of fileCodes) {
      expect(manifestCodes.has(code), `countries/${code}.svg exists but is not in the manifest`).toBe(true);
    }
    expect(files.length).toBe(271);
  });

  it.each(readdirSync(COUNTRIES_DIR).filter((f) => f.endsWith(".svg")))(
    "%s is well-formed and has a positive, finite intrinsic ratio",
    (file) => {
      const svg = readFileSync(join(COUNTRIES_DIR, file), "utf8");
      expect(svg).toMatch(/<svg[\s>]/);
      expect(svg.trim().endsWith("</svg>")).toBe(true);
      const ratio = intrinsicRatio(`countries/${file}`);
      expect(ratio).toBeGreaterThan(0);
      expect(Number.isFinite(ratio)).toBe(true);
      /* sanity bound — no real flag is this extreme; catches a mis-parsed
         viewBox rather than a genuinely unusual flag */
      expect(ratio).toBeGreaterThan(0.15);
      expect(ratio).toBeLessThan(6);
    },
  );

  it("is not suspiciously uniform — the old bug forced every single flag to exactly 4:3", () => {
    const ratios = files.map((f) => intrinsicRatio(`countries/${f}`));
    const at43 = ratios.filter((r) => Math.abs(r - 4 / 3) < 0.01).length;
    /* cd, ga, pg, sm are genuinely 4:3 (4), asean and pc are still unfixed
       (2), and xx is flag-icons' own unused placeholder glyph (1) — 7
       known. A regression that re-forces the whole set would put every one
       of the 271 at 4:3, not 7. */
    expect(at43).toBeLessThanOrEqual(7);
    expect(at43).toBeGreaterThanOrEqual(4);
  });
});

describe("full inventory: every US-state and Canadian-province/territory flag asset is well-formed", () => {
  for (const dir of ["us-states", "canada-regions"]) {
    const abs = join(FLAGS_DIR, dir);
    const files = readdirSync(abs).filter((f) => f.endsWith(".svg"));

    it(`${dir} has flag files present (not an empty/broken folder)`, () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)(`${dir}/%s is well-formed and has a positive, finite intrinsic ratio`, (file) => {
      const svg = readFileSync(join(abs, file), "utf8");
      expect(svg).toMatch(/<svg[\s>]/);
      const ratio = intrinsicRatio(`${dir}/${file}`);
      expect(ratio).toBeGreaterThan(0);
      expect(Number.isFinite(ratio)).toBe(true);
      expect(ratio).toBeGreaterThan(0.15);
      expect(ratio).toBeLessThan(6);
    });

    it(`${dir}: ratios are genuinely varied, not all forced to one shared box`, () => {
      const ratios = files.map((f) => intrinsicRatio(`${dir}/${f}`));
      const distinct = new Set(ratios.map((r) => r.toFixed(2)));
      /* real flags cluster around a few common ratios (3:2, 5:3, 2:1...) but
         should never collapse to a single value across dozens of files */
      expect(distinct.size).toBeGreaterThan(3);
    });
  }
});
