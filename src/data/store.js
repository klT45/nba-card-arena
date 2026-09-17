/**
 * Roster state and persistence.
 *
 * `state` is one mutable object shared by every module - pages read and write it
 * directly. That is deliberate at this size: the alternative is a subscription
 * layer, and the only genuinely reactive thing in the app is the lineup, which
 * `storage` events already cover across tabs.
 */
import { assetUrl } from "../lib/dom.js";

const LINEUP_KEY = "nba-card-lineup";

/** Never move this below `state`: `state.lineup` calls it during initialisation,
 *  and a `const` read before its declaration throws. The throw would be caught
 *  by the try/catch below and silently degrade to an empty lineup - which is
 *  exactly the bug the draw regression caught after the core.js split.
 *
 *  Must not read `state` for the same reason. Validation is shape-only. */
export function loadLineup() {
  try {
    const raw = JSON.parse(localStorage.getItem(LINEUP_KEY));
    // `|| {}` covers only falsy values, and JSON.parse is happy to hand back a
    // string, a number or an array for a corrupted key. A primitive then makes
    // `state.lineup[pos] = id` throw outright, because ES modules are always
    // strict mode. An array is quieter and still wrong: the assignment is
    // accepted, but `JSON.stringify([])` drops non-index properties, so the add
    // silently never persists. Check the shape, not the truthiness.
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}
export function saveLineup() {
  localStorage.setItem(LINEUP_KEY, JSON.stringify(state.lineup));
}

export const state = {
  players: [],
  styles: [],
  filter: { position: "ALL", team: "ALL", style: "ALL" },
  lineup: loadLineup(),
  heroIndex: 0,
};

/**
 * Drops lineup entries whose player is no longer in the manifest.
 *
 * Player ids do disappear from the pool - the admin backend is built around
 * adding a player before the art exists, and anything the user slotted while
 * such a player was around becomes a dangling id. Left in place, the two
 * readers of `state.lineup` disagree and the disagreement is silent:
 *
 *   renderLineup()  -> playerById() is undefined -> the slot is drawn as EMPTY
 *   positionsFor()  -> occupant is undefined     -> the chip stays enabled
 *   addPlayerAt()   -> `if (state.lineup[pos])` is TRUE -> throws on
 *                      `playerById(...).name`, inside a delegated click
 *                      listener, so the dialog never closes and no toast shows
 *
 * The user sees a free position that cannot be filled, and the count on the
 * arena board disagrees with the slots under it. Pruning makes the stored state
 * match what is already being drawn.
 *
 * Returns whether anything was removed. No-op while the manifest is still
 * loading, or an empty roster would wipe the user's lineup.
 *
 * Only writes when something actually changed. `saveLineup()` fires a `storage`
 * event in every other open tab, and those tabs call this again on the way to
 * re-rendering - so an unconditional write would have two tabs bouncing events
 * off each other for as long as both stay open.
 */
export function pruneLineup() {
  if (!state.players.length) return false;
  const live = new Set(state.players.map((p) => p.id));
  const entries = Object.entries(state.lineup);
  const kept = entries.filter(([, id]) => live.has(id));
  if (kept.length === entries.length) return false;
  state.lineup = Object.fromEntries(kept);
  saveLineup();
  return true;
}

export async function loadManifest() {
  const data = await fetch(assetUrl("/cards/manifest.json")).then((r) => {
    if (!r.ok) throw Error("球星卡清单加载失败");
    return r.json();
  });
  state.players = (data.players || []).map((p) => {
    if (!p.assets) return p;
    return {
      ...p,
      assets: {
        front: assetUrl(p.assets.front),
        thumb: assetUrl(p.assets.thumb),
        layers: p.assets.layers
          ? {
              subject: assetUrl(p.assets.layers.subject),
              background: assetUrl(p.assets.layers.background),
              lineart: assetUrl(p.assets.layers.lineart),
              text: assetUrl(p.assets.layers.text),
            }
          : p.assets.layers,
      },
    };
  });
  state.styles = data.styles || [];
  // Runs before anything renders, and before bindCardActions() wires up clicks.
  pruneLineup();
  return data;
}

export const playerById = (id) => state.players.find((p) => p.id === id);
export const styleName = (id) => state.styles.find((s) => s.id === id)?.name || id;

export function positionText(p) {
  return p.positions.map((x, i) => `${x} ${p.positionsZh[i]}`).join(" / ");
}

export function visiblePlayers() {
  const { position, team, style } = state.filter;
  return state.players.filter((p) =>
    (position === "ALL" || p.positions.includes(position)) &&
    (team === "ALL" || p.teamShort === team) &&
    (style === "ALL" || p.style === style));
}
