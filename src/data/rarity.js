/**
 * Rarity tiers - the single source of truth.
 *
 * This list used to be retyped by hand wherever it was needed, and the admin
 * copy was missing RARE. That is why the roster once ended up 12 MYTHIC / 2
 * ELITE: the dropdown literally had no other option, so nobody could pick one.
 * Import from here instead of retyping it.
 *
 * scripts/retier.py keeps its own TIERS table on purpose - it is the batch
 * re-tiering tool and cross-validates itself against players.json - but it is
 * the only place allowed to.
 */

/** Ordered top to bottom. Also the order the admin dropdown renders in. */
export const RARITY_ORDER = ["MYTHIC", "ELITE", "RARE", "COMMON"];

/* Relative odds rather than percentages. Integers keep the curve readable, and
   the pool is re-normalised per draw so removing taken players does not skew
   it. With the 3/5/6/8 roster this lands near 5 / 13 / 26 / 56 per cent. */
export const RARITY_WEIGHT = { MYTHIC: 2, ELITE: 3, RARE: 5, COMMON: 8 };

/** Charge-orb / stage tint per tier. */
export const RARITY_GLOW = {
  MYTHIC: "#c9ff3d",
  ELITE: "#7cc6f5",
  RARE: "#cbb0ff",
  COMMON: "#d9d2c4",
};

export const rarityOf = (p) => String(p?.rarity || "").toUpperCase();
export const glowOf = (p) => RARITY_GLOW[rarityOf(p)] || RARITY_GLOW.RARE;
