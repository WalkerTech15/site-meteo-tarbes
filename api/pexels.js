const PEXELS_SEARCH_ENDPOINT = "https://api.pexels.com/v1/search";
const PEXELS_PHOTOS_ENDPOINT = "https://api.pexels.com/v1/photos";

/* Pexels photo IDs are positive integers. Bounding the digit count keeps an
   absurdly long string from ever reaching the upstream URL. */
const ID_PATTERN = /^[1-9][0-9]{0,15}$/;
/* "Request multiple candidates instead of accepting only the first result" —
   the client ranks these against the location's name/region/country/photo
   metadata (see rankPexelsCandidates in photo-api.js) rather than trusting
   Pexels' own relevance order alone. */
const CANDIDATE_COUNT = 8;

function toPhotoPayload(photo) {
  if (!photo?.src?.large) return null;
  return {
    src: {
      medium: photo.src.medium,
      large: photo.src.large,
      large2x: photo.src.large2x,
    },
    photographer: photo.photographer || "",
    link: photo.url || "",
    alt: photo.alt || "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  /* Curated locations (src/js/data/locations.js) carry a manually reviewed
     Pexels photo ID so the hero/card image is guaranteed to show the actual
     landmark rather than whatever a text search ranks first. This branch
     fetches that exact photo; the search branch below is unchanged and still
     serves every other (non-curated) location. */
  const idParam = typeof req.query.id === "string" ? req.query.id.trim() : "";
  if (idParam) {
    if (!ID_PATTERN.test(idParam)) {
      return res.status(400).json({ error: "invalid_id" });
    }

    const key = process.env.PEXELS_API_KEY;
    if (!key) {
      return res.status(503).json({ error: "unavailable" });
    }

    try {
      const response = await fetch(`${PEXELS_PHOTOS_ENDPOINT}/${idParam}`, {
        headers: {
          Authorization: key,
          Accept: "application/json",
        },
      });

      if (response.status === 404) {
        return res.status(404).json({ error: "not_found" });
      }
      if (response.status === 429) {
        return res.status(429).json({ error: "rate_limited" });
      }
      if (!response.ok) {
        return res.status(502).json({ error: "upstream_error" });
      }

      const photo = await response.json();
      return res.status(200).json({ photo: toPhotoPayload(photo) });
    } catch {
      return res.status(502).json({ error: "upstream_error" });
    }
  }

  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";

  if (query.length < 2 || query.length > 120) {
    return res.status(400).json({ error: "invalid_query" });
  }

  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    return res.status(503).json({ error: "unavailable" });
  }

  try {
    const response = await fetch(
      `${PEXELS_SEARCH_ENDPOINT}?${new URLSearchParams({
        query,
        orientation: "landscape",
        per_page: String(CANDIDATE_COUNT),
        size: "medium",
      })}`,
      {
        headers: {
          Authorization: key,
          Accept: "application/json",
        },
      },
    );

    if (response.status === 429) {
      return res.status(429).json({ error: "rate_limited" });
    }

    if (!response.ok) {
      return res.status(502).json({ error: "upstream_error" });
    }

    const data = await response.json();
    const photos = (data.photos || []).map(toPhotoPayload).filter(Boolean);

    /* `photo` (first candidate) kept for anything relying on the old
       single-photo shape; `photos` is the new ranked-candidate pool the
       client picks the best match from (see rankPexelsCandidates in
       photo-api.js). */
    return res.status(200).json({ photo: photos[0] || null, photos });
  } catch {
    return res.status(502).json({ error: "upstream_error" });
  }
}
