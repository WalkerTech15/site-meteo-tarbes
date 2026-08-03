/* Country-jump shortcuts for the map view's filter chips (Monde/France/
   États-Unis/Canada). Plain data, no DOM/module dependency, so it is testable
   in isolation from the rest of features/map.js (which pulls in MapLibre and
   the sidebar's window.matchMedia use at import time). */
export const COUNTRY_JUMPS = {
  world: { center: [10, 22], zoom: 1.6 },
  france: { center: [2.2137, 46.2276], zoom: 5 },
  usa: { center: [-98.6, 39.8], zoom: 3.6 },
  canada: { center: [-96, 58.5], zoom: 2.8 },
};
