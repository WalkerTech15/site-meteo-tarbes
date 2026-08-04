/* What may be DRAWN as the boundary of the selected place.
 *
 * The rule this file exists to enforce: only a real polygon supplied by the
 * provider is ever drawn. A bounding box is four numbers describing a
 * rectangle around a shape — Texas is not a rectangle, and drawing its bbox
 * would tell the user something false about where the state ends. A bbox is
 * therefore used for camera framing only (see core/geo-bounds.js), and a
 * point-only result gets the marker's focus ring instead of an outline.
 *
 * Returning an empty FeatureCollection rather than null keeps the caller
 * simple: the GeoJSON source is always set, and "nothing to outline" is just
 * zero features. Pure — no map, no DOM. */

const AREA_GEOMETRIES = ["Polygon", "MultiPolygon"];

/* Administrative tiers whose full extent is worth framing when the provider
   gives a bounding box. A city or address is a point; framing its bbox would
   zoom out for no reason. */
const ADMIN_KINDS = ["country", "state", "province", "region"];

export function isAdministrativeArea(loc) {
  return ADMIN_KINDS.includes(loc?.kind);
}

export function hasAreaGeometry(loc) {
  return AREA_GEOMETRIES.includes(loc?.geometry?.type);
}

/**
 * GeoJSON for the selection-boundary source.
 * @returns a single Feature when there is a genuine area geometry, otherwise
 *          an empty FeatureCollection — never a rectangle built from a bbox.
 */
export function selectionFeature(loc) {
  if (!hasAreaGeometry(loc)) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "Feature",
    properties: { kind: loc.kind || "place" },
    geometry: loc.geometry,
  };
}
