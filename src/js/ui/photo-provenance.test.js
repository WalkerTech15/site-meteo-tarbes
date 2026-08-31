/* Provenance labelling — the rules that stop a weak photo being displayed as
 * a strong claim. Pure functions on plain objects: no DOM, no network. */
import { describe, it, expect, afterEach } from "vitest";
import {
  PROVENANCE_TIERS,
  photoProvenance,
  provenanceLabel,
  provenanceBadge,
  photoAltText,
} from "./photo-provenance.js";
import { state } from "../core/state.js";

const originalLang = state.lang;
afterEach(() => {
  state.lang = originalLang;
});

const photo = (over = {}) => ({ src: "x.jpg", photographer: "P", link: "https://x/", ...over });

describe("photoProvenance — deriving the tier", () => {
  it("honours a tier a provider set directly", () => {
    expect(photoProvenance(photo({ provenance: "nearby" }))).toBe("nearby");
    expect(photoProvenance(photo({ provenance: "exact" }))).toBe("exact");
  });

  it("maps the area fallback onto regional or country by the area it depicts", () => {
    expect(photoProvenance(photo({ approximate: true, areaKind: "region" }))).toBe("regional");
    expect(photoProvenance(photo({ approximate: true, areaKind: "country" }))).toBe("country");
  });

  it("treats an unmarked photo as exact — it got here by naming the place", () => {
    /* Pexels and the Commons text search both require positive evidence
       before they return anything, so an unlabelled photo really is a claim
       about the place itself. */
    expect(photoProvenance(photo())).toBe("exact");
  });

  it("ignores a bogus tier rather than trusting it", () => {
    expect(photoProvenance(photo({ provenance: "amazing" }))).toBe("exact");
  });

  it("is total on a missing photo", () => {
    expect(photoProvenance(null)).toBe("");
    expect(photoProvenance(undefined)).toBe("");
  });

  it("lists exactly the four tiers the UI knows how to render", () => {
    expect(PROVENANCE_TIERS).toEqual(["exact", "nearby", "regional", "country"]);
  });
});

describe("provenanceLabel — what the credit admits", () => {
  it("says nothing for an exact photo — silence already means 'this place'", () => {
    expect(provenanceLabel(photo())).toBe("");
    expect(provenanceLabel(photo({ provenance: "exact" }))).toBe("");
  });

  it("names the subject of a nearby photo when it knows it", () => {
    const label = provenanceLabel(photo({ provenance: "nearby", subjectName: "Tarbes Cathedral" }));
    expect(label).toContain("Tarbes Cathedral");
    /* Must still disclaim: naming the cathedral is not enough on its own. */
    expect(label.length).toBeGreaterThan("Tarbes Cathedral".length);
  });

  it("falls back to a plain nearby disclaimer with no subject", () => {
    const label = provenanceLabel(photo({ provenance: "nearby" }));
    expect(label).toBeTruthy();
    expect(label).not.toContain("{subject}");
  });

  it("keeps the existing wording for a regional or country photo", () => {
    const label = provenanceLabel(
      photo({ approximate: true, areaKind: "region", approximateOf: "Occitanie" }),
    );
    expect(label).toContain("Occitanie");
    expect(label).not.toContain("{area}");
  });

  it("never leaves an unsubstituted placeholder in any tier or language", () => {
    for (const lang of ["en", "fr"]) {
      state.lang = lang;
      for (const p of [
        photo({ provenance: "nearby" }),
        photo({ provenance: "nearby", subjectName: "X" }),
        photo({ approximate: true, areaKind: "region", approximateOf: "Y" }),
        photo({ approximate: true, areaKind: "country", approximateOf: "Z" }),
      ]) {
        expect(provenanceLabel(p)).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("is translated, not hardcoded to one language", () => {
    const p = photo({ provenance: "nearby" });
    state.lang = "en";
    const en = provenanceLabel(p);
    state.lang = "fr";
    const fr = provenanceLabel(p);
    expect(en).not.toBe(fr);
    expect(en).toBeTruthy();
    expect(fr).toBeTruthy();
  });
});

describe("provenanceBadge — the few words shown on the image", () => {
  it("is empty for an exact photo, so the common case stays uncluttered", () => {
    expect(provenanceBadge(photo())).toBe("");
  });

  it("is a short word for a nearby photo, not the full sentence", () => {
    const badge = provenanceBadge(photo({ provenance: "nearby", subjectName: "A Long Name Here" }));
    expect(badge).toBeTruthy();
    expect(badge.length).toBeLessThan(20);
  });

  it("names the area for a regional or country photo", () => {
    expect(
      provenanceBadge(photo({ approximate: true, areaKind: "region", approximateOf: "Occitanie" })),
    ).toBe("Occitanie");
  });
});

describe("photoAltText — no image is left unlabelled", () => {
  it("keeps a provider's own description when it has one", () => {
    expect(photoAltText(photo({ alt: "Eiffel Tower at dusk" }), "Paris")).toBe(
      "Eiffel Tower at dusk",
    );
  });

  it("composes a sentence for a caption-less photo, naming the place", () => {
    /* Mapillary returns no caption at all — without this a screen-reader user
       meets an unlabelled image where a sighted user sees a credit. */
    const alt = photoAltText(photo({ source: "mapillary", provenance: "nearby" }), "Tarbes");
    expect(alt).toContain("Tarbes");
    expect(alt).not.toMatch(/\{\w+\}/);
  });

  it("distinguishes a nearby photo from an exact one in the alt text too", () => {
    const near = photoAltText(photo({ provenance: "nearby" }), "Tarbes");
    const exact = photoAltText(photo({ provenance: "exact" }), "Tarbes");
    expect(near).not.toBe(exact);
  });

  it("returns empty rather than a meaningless sentence with no place name", () => {
    expect(photoAltText(photo(), "")).toBe("");
    expect(photoAltText(null, "Tarbes")).toBe("");
  });
});
