/* Edge-fade visibility for a horizontally-scrolling carousel, derived from
   scroll geometry. Pure so the thresholds are unit-testable without a DOM.
   EPSILON is a few px, not 1: `scroll-snap-type: x` can leave a freshly
   laid-out row a couple of pixels off zero as it settles onto the first
   snap point, which must read as "at the start", not "already scrolled". */
const EPSILON = 6;
export function computeFadeVisibility({ scrollLeft, scrollWidth, clientWidth }) {
  const max = scrollWidth - clientWidth;
  if (max <= EPSILON) return { left: false, right: false };
  return { left: scrollLeft > EPSILON, right: scrollLeft < max - EPSILON };
}
