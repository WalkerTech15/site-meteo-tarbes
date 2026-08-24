const PEXELS_ENDPOINT = "https://api.pexels.com/v1/search";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
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
      `${PEXELS_ENDPOINT}?${new URLSearchParams({
        query,
        orientation: "landscape",
        per_page: "1",
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
    const photo = data.photos?.[0];

    if (!photo?.src?.large) {
      return res.status(200).json({ photo: null });
    }

    return res.status(200).json({
      photo: {
        src: {
          medium: photo.src.medium,
          large: photo.src.large,
          large2x: photo.src.large2x,
        },
        photographer: photo.photographer || "",
        link: photo.url || "",
        alt: photo.alt || "",
      },
    });
  } catch {
    return res.status(502).json({ error: "upstream_error" });
  }
}
