/* How honest the photo on screen is about what it shows.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The photo chain has seven steps and they do NOT all make the same claim.
 * A curated image and a Google place match really are pictures of the
 * selected place. A Mapillary frame is a picture taken at the place. A region
 * fallback is a picture of somewhere nearby that happens to be in the same
 * administrative area. Displaying all three identically — a photo, a
 * photographer, a source link — silently upgrades the weakest of them into a
 * claim it cannot support, which is the exact failure the whole pipeline
 * exists to prevent.
 *
 * So every photo carries a `provenance`, and the credit says which:
 *
 *   exact     this IS the selected place            (no qualifier shown)
 *   nearby    taken at or beside it                 "Nearby · <landmark>"
 *   regional  somewhere in the surrounding region   "Photo of <region>, not
 *                                                    of this place itself"
 *   country   somewhere in the country              same, with the country
 *
 * `exact` deliberately shows no qualifier: adding "exact photo" to the common
 * case would be noise, and an absent qualifier already means "this is the
 * place". The other three are always announced.
 *
 * Pure functions only — no DOM, no state — so every wording rule is testable
 * and the renderer in services/photo-api.js stays a renderer.
 */
import { t } from "../core/i18n.js";

export const PROVENANCE_TIERS = ["exact", "nearby", "regional", "country"];

/* The one place that decides a photo's tier, so no caller has to re-derive it
   from a mix of `source`, `approximate` and `approximateOf`. Providers set
   `provenance` directly (Google, Mapillary); the older ones are mapped from
   the fields they already carry, which keeps their code untouched. */
export function photoProvenance(photo) {
  if (!photo) return "";
  if (PROVENANCE_TIERS.includes(photo.provenance)) return photo.provenance;
  /* The area fallback (services/photo-api.js) marks itself `approximate` and
     names the area it actually depicts. */
  if (photo.approximate) return photo.areaKind === "country" ? "country" : "regional";
  /* Everything else got here by naming the place or by sitting on its
     coordinates, both of which are claims about the place itself. */
  return "exact";
}

/**
 * The qualifier shown before the source, or "" for an exact match.
 *
 * @returns {string} already-localized, NOT html-escaped (callers escape).
 */
export function provenanceLabel(photo) {
  const tier = photoProvenance(photo);
  if (tier === "exact" || tier === "") return "";
  if (tier === "nearby") {
    /* Name the subject when we know it ("Nearby · Tarbes Cathedral"), so the
       visitor can see WHAT they are looking at rather than only being told
       it is not the city. */
    const subject = photo.subjectName || "";
    return subject ? t("photoNearbyNamed").replace("{subject}", subject) : t("photoNearby");
  }
  /* regional / country — the existing wording, which already says plainly
     that this is not a photo of the place itself. */
  return t("photoApproximate").replace("{area}", photo.approximateOf || "");
}

/* The short text that sits ON the image. Kept to a few words: the full
   sentence lives in the link's accessible name and tooltip. */
export function provenanceBadge(photo) {
  const tier = photoProvenance(photo);
  if (tier === "nearby") return t("photoNearbyShort");
  if (tier === "regional" || tier === "country") return photo.approximateOf || "";
  return "";
}

/**
 * Alt text for the image itself.
 *
 * A provider that describes its own photo (Pexels' caption, a Commons file
 * description) keeps that description — it is better than anything generated
 * here. A provider that does not (Mapillary returns no caption at all) gets a
 * sentence naming the place and the tier, so a screen-reader user is told the
 * same thing a sighted user reads in the credit, rather than meeting an
 * unlabelled image.
 */
export function photoAltText(photo, placeName) {
  if (!photo) return "";
  if (photo.alt) return photo.alt;
  const name = placeName || "";
  if (!name) return "";
  const tier = photoProvenance(photo);
  if (tier === "nearby") return t("photoAltNearby").replace("{place}", name);
  return t("photoAltExact").replace("{place}", name);
}
