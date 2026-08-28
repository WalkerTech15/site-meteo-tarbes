# Country flag asset sources

This folder previously vendored flag-icons 7.5.0's "4x3" set, which forces
every flag onto the same 640x480 canvas — stretching or squashing each
flag's real proportions to fit. It has been replaced so every flag uses its
own authentic aspect ratio and complete, undistorted artwork.

## 255 ISO 3166-1 country codes

Replaced with the matching file from
[hampusborgos/country-flags](https://github.com/hampusborgos/country-flags)
(also published as the `svg-country-flags` npm package). That project draws
every flag at its own real, legally-documented proportions, sourced from and
verified against Wikimedia Commons. Its README states flags are in the
public domain. Filenames are unchanged (still lowercase ISO code + `.svg`),
so the existing lookup logic in `src/js/data/flags.js` needed no changes.

## 12 non-ISO codes (territories / organizations)

flag-icons also ships some non-ISO entries for constituent countries,
dependent territories, and organizations. `gb-eng`, `gb-nir`, `gb-sct`,
`gb-wls`, `xk`, and `eu` were already available, authentically-ratioed, in
hampusborgos/country-flags and are included in the 255 above. The following
12 were not, and were instead replaced individually with a specific,
verified-free file from Wikimedia Commons:

| code | entity | Commons file | ratio |
|---|---|---|---|
| arab | Arab League | Flag_of_the_Arab_League.svg | ~2:1 |
| un | United Nations | Flag_of_the_United_Nations.svg | 3:2 |
| dg | British Indian Ocean Territory (Diego Garcia) | Flag_of_the_British_Indian_Ocean_Territory_2025.svg | 1:2 |
| sh-hl | Saint Helena | Flag_of_Saint_Helena.svg | 1:2 |
| sh-ta | Tristan da Cunha | Flag_of_Tristan_da_Cunha.svg | 1:2 |
| sh-ac | Ascension Island | Flag_of_Ascension_Island.svg | 1:2 |
| es-ct | Catalonia | Flag_of_Catalonia.svg | 3:2 |
| es-ga | Galicia | Flag_of_Galicia.svg | 3:2 |
| es-pv | Basque Country | Flag_of_the_Basque_Country.svg | ~25:14 |
| ic | Canary Islands | Flag_of_the_Canary_Islands.svg | 3:2 |
| eac | East African Community | Flag_of_the_East_African_Community_(no_logo).svg | ~20:11 |
| cefta | CEFTA | Flag_of_CEFTA.svg | ~326:223 |

## 1 code with no distinct flag

`cp` (Clipperton Island): an uninhabited French possession with no flag of
its own; by documented convention it uses the French tricolour. Redrawn to
match `fr.svg` exactly (same colors, same 3:2 ratio) rather than left at the
old forced-4:3 box.

## 2 unresolved — left unchanged

`asean` (ASEAN) and `pc` (Pacific Community) have no SVG on Wikimedia
Commons under a free license at the time of writing (ASEAN's flag file on
English Wikipedia exists but is tagged non-free/local-only, so it was not
used). Their files are still the original flag-icons artwork, forced into a
4:3 box — **not fixed**. Replace them if/when a verifiably free, authentic
source becomes available; do not guess their real proportions.

## 1 non-flag placeholder — not applicable

`xx` is flag-icons' own generic "unknown flag" glyph, not a real-world flag.
It is listed in `country-flag-codes.js`'s manifest but is never actually
assigned to a location (see `src/js/data/locations.js`) and unknown geocoder
codes get a text fallback instead, per that file's own comment — so it is
inert in this app. Left unchanged.
