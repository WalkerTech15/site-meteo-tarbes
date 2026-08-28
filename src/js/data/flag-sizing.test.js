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
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = join(HERE, "../../styles");
const FLAGS_DIR = join(HERE, "../../../public/assets/flags");

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

/* Intrinsic aspect ratio of each SVG, read straight from its own viewBox (or
 * width/height attributes when there's no viewBox) — the same ratio the
 * browser uses to lay it out, independent of any CSS in this repo. */
function intrinsicRatio(relPath) {
  const abs = join(FLAGS_DIR, relPath);
  expect(existsSync(abs), `missing asset: ${relPath}`).toBe(true);
  const svg = readFileSync(abs, "utf8");
  const vb = svg.match(/viewBox="[^"]*?(-?[\d.]+)\s+(-?[\d.]+)"/);
  if (vb) return Number(vb[1]) / Number(vb[2]);
  const wh = svg.match(/width="(\d+(?:\.\d+)?)"[^>]*height="(\d+(?:\.\d+)?)"/);
  expect(wh, `no viewBox or width/height on ${relPath}`).not.toBeNull();
  return Number(wh[1]) / Number(wh[2]);
}

describe("intrinsic flag ratios: USA, France, Japan (countries) vs Texas, California, New York (states)", () => {
  it("every local country flag asset — including the US — shares the same 4:3 ratio", () => {
    const us = intrinsicRatio("countries/us.svg");
    const fr = intrinsicRatio("countries/fr.svg");
    const jp = intrinsicRatio("countries/jp.svg");
    for (const r of [us, fr, jp]) expect(r).toBeCloseTo(4 / 3, 2);
  });

  it("US state flags do NOT share the country flags' 4:3 ratio — this is why height-based sizing (not a fixed width) is required", () => {
    const countryRatio = intrinsicRatio("countries/us.svg");
    const texas = intrinsicRatio("us-states/texas.svg");
    const california = intrinsicRatio("us-states/california.svg");
    const newYork = intrinsicRatio("us-states/new-york.svg");
    /* Texas/California are ~3:2, New York ~2:1 — none of the three is 4:3 */
    for (const r of [texas, california, newYork]) {
      expect(Math.abs(r - countryRatio)).toBeGreaterThan(0.05);
    }
    /* and none of them is an accidentally-square/placeholder asset */
    for (const r of [texas, california, newYork]) {
      expect(Math.abs(r - 1)).toBeGreaterThan(0.1);
    }
  });
});
