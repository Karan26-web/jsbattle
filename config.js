// ============================================================================
// JSBattle — configuration
//
// Fill these in with your Supabase project's values to turn on real accounts,
// a global leaderboard, and cross-device ranking.
//
//   Supabase dashboard -> Project Settings -> API
//     Project URL  ->  SUPABASE_URL
//     anon public  ->  SUPABASE_ANON_KEY
//
// The anon key is designed to be public — it is safe in client code. All
// access control is enforced by Row Level Security (see supabase-schema.sql).
//
// Leave these as the placeholders and the app runs fully offline against
// localStorage instead. Nothing breaks; you just get a local-only leaderboard.
// ============================================================================

window.JSBATTLE_CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY"
};

window.JSBATTLE_CONFIG.isConfigured = (function () {
  const c = window.JSBATTLE_CONFIG;
  return (
    typeof c.SUPABASE_URL === "string" &&
    c.SUPABASE_URL.startsWith("http") &&
    typeof c.SUPABASE_ANON_KEY === "string" &&
    c.SUPABASE_ANON_KEY.length > 30
  );
})();
