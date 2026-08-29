/* Ranking rules for location photos — the "which candidate best shows THIS
 * place" half of the pipeline. Pure functions on plain objects: no network,
 * no DOM, no shared state. The complementary "is this obviously unrelated"
 * filter is tested in photo-api.test.js. */
import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  significantWords,
  locationTokens,
  photoHaystack,
  distanceKm,
  proximityScore,
  qualityScore,
  scorePhotoForLocation,
  pickBestPhoto,
  isMarineKind,
} from "./photo-relevance.js";

const TARBES = {
  kind: "city",
  name: { en: "Tarbes", fr: "Tarbes" },
  region: { en: "Occitania", fr: "Occitanie" },
  country: { en: "France", fr: "France" },
  lat: 43.2333,
  lon: 0.0782,
};

const NEW_YORK = {
  kind: "city",
  name: { en: "New York", fr: "New York" },
  region: { en: "New York State", fr: "État de New York" },
  country: { en: "United States", fr: "États-Unis" },
  aliases: ["nyc", "new york city"],
  lat: 40.7128,
  lon: -74.006,
};

const ATLANTIC = {
  kind: "ocean",
  waterKind: "ocean",
  name: { en: "Atlantic Ocean", fr: "Océan Atlantique" },
  lat: 33.2,
  lon: -41.5,
};

const photo = (over = {}) => ({ src: "x.jpg", alt: "", photographer: "", ...over });

describe("normalizeForMatch / significantWords", () => {
  it("strips diacritics so the two languages compare on equal footing", () => {
    expect(normalizeForMatch("Océan Atlantique")).toBe("ocean atlantique");
    expect(normalizeForMatch("Québec")).toBe("quebec");
  });

  it("drops words shorter than three letters and generic connectors", () => {
    expect(significantWords("San Francisco")).toEqual(["francisco"]);
    expect(significantWords("Port-au-Prince")).toEqual(["prince"]);
  });

  it("yields no tokens for a non-Latin name rather than inventing them", () => {
    /* This is what makes the "cannot confirm" path reachable — see the
       confidence tests below. */
    expect(significantWords("東京")).toEqual([]);
    expect(significantWords("Москва")).toEqual([]);
  });

  it("is total on junk input", () => {
    expect(normalizeForMatch(null)).toBe("");
    expect(significantWords(undefined)).toEqual([]);
  });
});

describe("locationTokens", () => {
  it("collects BOTH language spellings of every field", () => {
    const t = locationTokens(TARBES);
    expect([...t.name]).toEqual(["tarbes"]);
    /* "Occitania" (en) and "Occitanie" (fr) are different words — a photo
       captioned in either language should count as naming the region */
    expect([...t.region].sort()).toEqual(["occitania", "occitanie"]);
  });

  it("includes curated aliases, ranked as their own group", () => {
    const t = locationTokens(NEW_YORK);
    expect([...t.alias]).toContain("nyc");
  });

  it("never double-counts a token across groups", () => {
    const t = locationTokens(NEW_YORK);
    /* "york" is in the name AND the region ("New York State") — it must
       score once, at the name's weight, not twice */
    expect(t.name.has("york")).toBe(true);
    expect(t.region.has("york")).toBe(false);
    expect(t.alias.has("york")).toBe(false);
  });

  it("is total on a location with no fields at all", () => {
    const t = locationTokens({});
    expect(t.name.size).toBe(0);
    expect(locationTokens(null).country.size).toBe(0);
  });
});

describe("photoHaystack", () => {
  it("folds every text field a provider might supply into one string", () => {
    const hay = photoHaystack({
      alt: "Bridge",
      title: "Pont de Tarbes",
      description: "Occitanie",
      photographer: "Ada",
    });
    expect(hay).toContain("bridge");
    expect(hay).toContain("tarbes");
    expect(hay).toContain("occitanie");
    expect(hay).toContain("ada");
  });

  it("returns an empty string for a photo with no text", () => {
    expect(photoHaystack(photo())).toBe("");
    expect(photoHaystack(null)).toBe("");
  });
});

describe("distanceKm / proximityScore", () => {
  it("measures a known distance to within a few percent", () => {
    /* Paris → London is ~344 km */
    const d = distanceKm(48.8566, 2.3522, 51.5074, -0.1278);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
  });

  it("is null when either point is missing a coordinate", () => {
    expect(distanceKm(1, 2, null, 4)).toBeNull();
    expect(distanceKm(NaN, 2, 3, 4)).toBeNull();
  });

  it("scores closer photos higher, and an untagged photo neutrally", () => {
    const at = (lat, lon) => proximityScore(TARBES, photo({ lat, lon }));
    expect(at(43.2333, 0.0782)).toBe(4); /* same point */
    expect(at(43.2333, 0.0782)).toBeGreaterThan(at(43.26, 0.11)); /* ~4 km away */
    expect(proximityScore(TARBES, photo())).toBe(0); /* no coordinates */
  });

  it("penalises a photo tagged well outside the search radius", () => {
    expect(proximityScore(TARBES, photo({ lat: 48.85, lon: 2.35 }))).toBeLessThan(0);
  });
});

describe("qualityScore", () => {
  it("prefers landscape and reasonably large images", () => {
    expect(qualityScore({ width: 1600, height: 900 })).toBe(2);
    expect(qualityScore({ width: 600, height: 1200 })).toBe(0);
    expect(qualityScore({ width: 800, height: 600 })).toBe(1); /* landscape but small */
  });

  it("is neutral when a provider reports no dimensions", () => {
    expect(qualityScore(photo())).toBe(0);
    expect(qualityScore(null)).toBe(0);
  });
});

describe("scorePhotoForLocation", () => {
  it("scores an exact place-name mention far above a region-only match", () => {
    const named = scorePhotoForLocation(TARBES, photo({ alt: "Aerial view of Tarbes" }));
    const regionOnly = scorePhotoForLocation(TARBES, photo({ alt: "Countryside in Occitanie" }));
    expect(named.score).toBeGreaterThan(regionOnly.score);
    expect(named.confidence).toBe("text");
    expect(regionOnly.confidence).toBe("text");
  });

  it("matches a caption written in the OTHER interface language", () => {
    /* "États-Unis" never appears in the English name, but is a real
       spelling of this location's country */
    const fr = scorePhotoForLocation(NEW_YORK, photo({ alt: "Un gratte-ciel aux États-Unis" }));
    expect(fr.score).toBeGreaterThan(0);
    expect(fr.confidence).toBe("text");
  });

  it("credits a curated alias", () => {
    const viaAlias = scorePhotoForLocation(NEW_YORK, photo({ alt: "NYC at night" }));
    expect(viaAlias.score).toBeGreaterThan(0);
    expect(viaAlias.confidence).toBe("text");
  });

  it("reports coordinate confidence when the text says nothing", () => {
    const near = scorePhotoForLocation(
      TARBES,
      photo({ alt: "Old stone bridge", lat: 43.234, lon: 0.079 }),
    );
    expect(near.confidence).toBe("coordinate");
    expect(near.score).toBeGreaterThan(0);
  });

  it("reports no confidence when nothing connects photo to place", () => {
    expect(scorePhotoForLocation(TARBES, photo({ alt: "A cup of coffee" })).confidence).toBe(
      "none",
    );
  });

  it("reports no confidence for a location with no Latin-script identity", () => {
    /* The geocoder only had the local name — there is nothing to verify a
       text result against, which callers must be able to detect */
    const local = { kind: "city", name: { en: "東京", fr: "東京" }, region: {}, country: {} };
    expect(scorePhotoForLocation(local, photo({ alt: "A beautiful street" })).confidence).toBe(
      "none",
    );
  });

  it("penalises an urban photo chosen for open water", () => {
    const urban = scorePhotoForLocation(ATLANTIC, photo({ alt: "Atlantic City skyline" }));
    const openWater = scorePhotoForLocation(ATLANTIC, photo({ alt: "Atlantic Ocean waves" }));
    expect(openWater.score).toBeGreaterThan(urban.score);
  });

  it("is total on missing arguments", () => {
    expect(scorePhotoForLocation(null, photo()).confidence).toBe("none");
    expect(scorePhotoForLocation(TARBES, null).score).toBe(0);
  });
});

describe("pickBestPhoto", () => {
  it("returns the highest-scoring candidate regardless of input order", () => {
    const weak = photo({ src: "1.jpg", alt: "France countryside" });
    const strong = photo({ src: "2.jpg", alt: "Tarbes town square, France" });
    expect(pickBestPhoto(TARBES, [weak, strong])).toBe(strong);
    expect(pickBestPhoto(TARBES, [strong, weak])).toBe(strong);
  });

  it("keeps the provider's own order when scores tie", () => {
    const first = photo({ src: "1.jpg", alt: "Tarbes" });
    const second = photo({ src: "2.jpg", alt: "Tarbes" });
    expect(pickBestPhoto(TARBES, [first, second])).toBe(first);
  });

  it("uses coordinate proximity to separate two equally-worded candidates", () => {
    const far = photo({ src: "far.jpg", alt: "Bridge", lat: 48.85, lon: 2.35 });
    const near = photo({ src: "near.jpg", alt: "Bridge", lat: 43.234, lon: 0.079 });
    expect(pickBestPhoto(TARBES, [far, near])).toBe(near);
  });

  it("uses image quality only as a tiebreaker, never over a name match", () => {
    const bigGeneric = photo({ src: "big.jpg", alt: "France", width: 4000, height: 2000 });
    const smallNamed = photo({ src: "small.jpg", alt: "Tarbes", width: 400, height: 500 });
    expect(pickBestPhoto(TARBES, [bigGeneric, smallNamed])).toBe(smallNamed);
  });

  it("drops candidates with no usable src", () => {
    const noSrc = { alt: "Tarbes France" };
    const withSrc = photo({ alt: "Tarbes France" });
    expect(pickBestPhoto(TARBES, [noSrc, withSrc])).toBe(withSrc);
  });

  it("returns null for an empty or missing pool", () => {
    expect(pickBestPhoto(TARBES, [])).toBeNull();
    expect(pickBestPhoto(TARBES, null)).toBeNull();
    expect(pickBestPhoto(TARBES, undefined)).toBeNull();
  });

  it("with requireEvidence, refuses a candidate nothing connects to the place", () => {
    const unverifiable = photo({ alt: "A pleasant view" });
    expect(pickBestPhoto(TARBES, [unverifiable])).toBe(unverifiable);
    expect(pickBestPhoto(TARBES, [unverifiable], { requireEvidence: true })).toBeNull();
  });

  it("with requireEvidence, still accepts a coordinate-tagged candidate", () => {
    const nearby = photo({ alt: "Old stone bridge", lat: 43.234, lon: 0.079 });
    expect(pickBestPhoto(TARBES, [nearby], { requireEvidence: true })).toBe(nearby);
  });
});

describe("isMarineKind", () => {
  it("recognises the open-water kinds and nothing else", () => {
    expect(isMarineKind("ocean")).toBe(true);
    expect(isMarineKind("sea")).toBe(true);
    expect(isMarineKind("city")).toBe(false);
    expect(isMarineKind("country")).toBe(false);
    expect(isMarineKind(undefined)).toBe(false);
  });
});
