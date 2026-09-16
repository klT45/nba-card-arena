/**
 * Motion preferences. Every animation layer (GSAP timeline, CSS keyframes via
 * the same media query, the shader clock) reads this one predicate so the
 * degraded mode stays consistent.
 */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
