// ============================================================================
// Scoring + ranking.
//
// Design goal: one XP currency. A Visual Match win and a Code-Golf win must be
// worth roughly the same, otherwise a global ranking is just "who played the
// higher-scoring category". So both scorers normalise against the level's
// `par` and emit 0-1000.
// ============================================================================

const MAX_LEVEL_SCORE = 1000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ----------------------------------------------------------------------------
// Visual Match
//
// Pixel match below 60% earns nothing — at that point you are mostly matching
// the background, not the drawing. From 60% to 100% the curve is convex, so
// the last few percent (the fiddly bits) are where the points actually are.
// A brevity bonus unlocks only once the render is essentially exact.
// ----------------------------------------------------------------------------
function scoreVisual(pixelMatchPct, charCount, par) {
  const accuracy = clamp((pixelMatchPct - 60) / 40, 0, 1);
  const base = 900 * Math.pow(accuracy, 1.5);
  let brevity = 0;
  if (pixelMatchPct >= 97 && par > 0) {
    // Full 100 bonus at par/2 chars or fewer, tapering to 0 at 1.5x par.
    brevity = 100 * clamp((par * 1.5 - charCount) / par, 0, 1);
  }
  return Math.round(clamp(base + brevity, 0, MAX_LEVEL_SCORE));
}

// ----------------------------------------------------------------------------
// Code-Golf
//
// Correctness is a gate, not a score: every hidden test must pass or you get
// zero. Past that, it is pure brevity against par. Hitting par exactly is a
// perfect 1000; beating par cannot exceed 1000, so there is no runaway.
// ----------------------------------------------------------------------------
function scoreGolf(allPassed, charCount, par) {
  if (!allPassed) return 0;
  if (charCount <= 0) return 0;
  const efficiency = clamp(par / charCount, 0, 1);
  return Math.round(clamp(400 + 600 * efficiency, 0, MAX_LEVEL_SCORE));
}

// ----------------------------------------------------------------------------
// Per-level medals
// ----------------------------------------------------------------------------
const MEDALS = [
  { key: "gold", label: "Gold", min: 900 },
  { key: "silver", label: "Silver", min: 750 },
  { key: "bronze", label: "Bronze", min: 500 }
];

function medalFor(score) {
  if (!score) return null;
  return MEDALS.find((m) => score >= m.min) || null;
}

// ----------------------------------------------------------------------------
// Global tiers
//
// Thresholds are pinned to a fraction of the theoretical maximum rather than
// to absolute numbers, so adding levels does not silently promote everyone.
// ----------------------------------------------------------------------------
const TIERS = [
  { key: "master", label: "Master", min: 0.88, color: "#ff5470", icon: "◆◆◆" },
  { key: "diamond", label: "Diamond", min: 0.72, color: "#5eead4", icon: "◆◆" },
  { key: "platinum", label: "Platinum", min: 0.56, color: "#a5b4fc", icon: "◆" },
  { key: "gold", label: "Gold", min: 0.38, color: "#f5a623", icon: "▲▲" },
  { key: "silver", label: "Silver", min: 0.2, color: "#c7cbd8", icon: "▲" },
  { key: "bronze", label: "Bronze", min: 0, color: "#b87333", icon: "●" }
];

function maxPossibleXp(levelCount) {
  return levelCount * MAX_LEVEL_SCORE;
}

function tierFor(totalXp, levelCount) {
  const max = maxPossibleXp(levelCount) || 1;
  const ratio = totalXp / max;
  return TIERS.find((t) => ratio >= t.min) || TIERS[TIERS.length - 1];
}

// Returns { tier, next, xpIntoTier, xpForNextTier, pctToNext } — everything the
// progress bar needs, with `next` null when already at Master.
function tierProgress(totalXp, levelCount) {
  const max = maxPossibleXp(levelCount) || 1;
  const tier = tierFor(totalXp, levelCount);
  const idx = TIERS.indexOf(tier);
  const next = idx > 0 ? TIERS[idx - 1] : null;

  const floor = tier.min * max;
  if (!next) {
    return { tier, next: null, xpIntoTier: totalXp - floor, xpForNextTier: 0, pctToNext: 100 };
  }
  const ceiling = next.min * max;
  const span = ceiling - floor || 1;
  return {
    tier,
    next,
    xpIntoTier: Math.round(totalXp - floor),
    xpForNextTier: Math.round(ceiling - totalXp),
    pctToNext: clamp(((totalXp - floor) / span) * 100, 0, 100)
  };
}
