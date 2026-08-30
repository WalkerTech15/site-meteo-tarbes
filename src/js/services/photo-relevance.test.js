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
  namesConflictingPlace,
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

/* ── Landmark ranking + the "shows somewhere else" rule ───────────────── */

const withLandmark = {
  id: "sf",
  kind: "city",
  name: { en: "San Francisco", fr: "San Francisco" },
  region: { en: "California", fr: "Californie" },
  country: { en: "United States", fr: "États-Unis" },
  aliases: ["sfo"],
  landmark: { emoji: "🌉", en: "Golden Gate Bridge", fr: "Pont du Golden Gate" },
  lat: 37.7749,
  lon: -122.4194,
};

const shot = (alt, extra = {}) => ({ alt, src: "https://x/y.jpg", ...extra });

describe("locationTokens — landmark tier", () => {
  it("collects the curated landmark's own words, in both languages", () => {
    const t = locationTokens(withLandmark);
    expect(t.landmark.has("golden")).toBe(true);
    expect(t.landmark.has("gate")).toBe(true);
    expect(t.landmark.has("bridge")).toBe(true);
    expect(t.landmark.has("pont")).toBe(true);
  });

  it("never double-counts a word the name or an alias already covers", () => {
    const t = locationTokens({
      ...withLandmark,
      landmark: { en: "San Francisco Bay", fr: "Baie de San Francisco" },
    });
    for (const tok of t.name) expect(t.landmark.has(tok)).toBe(false);
    for (const tok of t.alias) expect(t.landmark.has(tok)).toBe(false);
  });

  it("is empty for a location with no curated landmark", () => {
    expect(locationTokens({ ...withLandmark, landmark: null }).landmark.size).toBe(0);
    expect(locationTokens(null).landmark.size).toBe(0);
  });
});

describe("scorePhotoForLocation — landmark evidence", () => {
  it("ranks a photo naming the place's own landmark above a generic one", () => {
    const named = scorePhotoForLocation(withLandmark, shot("The Golden Gate Bridge at sunrise"));
    const generic = scorePhotoForLocation(withLandmark, shot("A bridge somewhere"));
    expect(named.score).toBeGreaterThan(generic.score);
    expect(named.confidence).toBe("text");
  });

  it("still ranks naming the place itself above naming only its landmark", () => {
    const place = scorePhotoForLocation(withLandmark, shot("Downtown San Francisco"));
    const landmarkOnly = scorePhotoForLocation(withLandmark, shot("Golden Gate at dusk"));
    expect(place.score).toBeGreaterThan(landmarkOnly.score);
  });
});

describe("namesConflictingPlace", () => {
  /* token → owning place id, the shape services/photo-api.js builds from the
     curated location list. */
  const vocab = new Map([
    ["paris", "paris"],
    ["eiffel", "paris"],
    ["tower", "paris"],
    ["tokyo", "tokyo"],
    ["kyoto", "kyoto"],
  ]);
  const tarbes = {
    id: "mt-tarbes",
    kind: "town",
    name: { en: "Tarbes", fr: "Tarbes" },
    region: { en: "Occitania", fr: "Occitanie" },
    country: { en: "France", fr: "France" },
    aliases: [],
    landmark: null,
  };

  it("rejects a photo that names a different known place", () => {
    expect(namesConflictingPlace(tarbes, shot("The Eiffel Tower in Paris"), vocab)).toBe(true);
    expect(namesConflictingPlace(tarbes, shot("Neon signs in Tokyo"), vocab)).toBe(true);
  });

  it("accepts a photo that also names the location itself", () => {
    expect(namesConflictingPlace(tarbes, shot("Tarbes, on the road to Paris"), vocab)).toBe(false);
  });

  it("accepts a photo naming the location's own region or country", () => {
    expect(namesConflictingPlace(tarbes, shot("Occitania farmland"), vocab)).toBe(false);
    expect(namesConflictingPlace(tarbes, shot("Rural France"), vocab)).toBe(false);
  });

  it("never flags a place against its own curated entry", () => {
    const paris = {
      id: "paris",
      kind: "city",
      name: { en: "Paris", fr: "Paris" },
      region: {},
      country: { en: "France" },
      aliases: [],
      landmark: { en: "Eiffel Tower", fr: "Tour Eiffel" },
    };
    expect(namesConflictingPlace(paris, shot("The Eiffel Tower"), vocab)).toBe(false);
  });

  it("says nothing when there is no text, no vocabulary, or no photo", () => {
    expect(namesConflictingPlace(tarbes, shot(""), vocab)).toBe(false);
    expect(namesConflictingPlace(tarbes, shot("Anywhere"), new Map())).toBe(false);
    expect(namesConflictingPlace(tarbes, null, vocab)).toBe(false);
    expect(namesConflictingPlace(null, shot("Paris"), vocab)).toBe(false);
  });

  it("ignores a token two curated places share, which identifies neither", () => {
    /* photo-api drops such tokens when building the map; an empty owner is
       treated as "not a conflict" here too, belt and braces. */
    const ambiguous = new Map([["springfield", ""]]);
    expect(namesConflictingPlace(tarbes, shot("Springfield main street"), ambiguous)).toBe(false);
  });
});
