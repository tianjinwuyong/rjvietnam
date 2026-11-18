/**
 * rjvn IQC core business logic port (NestJS/Drizzle -> Express/raw-pg).
 *
 * Source: D:\rj\rjvn\WMS-20261019\server\modules\iqc\
 *   strictness.service.ts    - strictness state machine + counting rules
 *   sampling-plan.service.ts - GB/T 2828.1-2012 sampling tables & Ac/Re
 *   iqc.service.ts           - per-item verdict / batch decision derivation
 *   iqc-template.service.ts / iqc-standard-item.service.ts - template defaults
 * All oa-*.ts files intentionally skipped (OA out of scope).
 *
 * Operates on the EXISTING public.rjvn_* mirror tables in `smt_factory`.
 * Pure logic is exported at the top; DB routes are registered via
 * registerRjvnIqcRoutes(app, pgPool, requirePermission).
 */

// ── Tunable constants (thresholds from the source, kept in one place) ──
export const CONFIG = {
  defaults: {
    strictness: "normal",         // strictness.service.ts:73 (getOrCreate)
    inspectionLevel: "II",        // strictness.service.ts:74
    aql: "0.4",                   // strictness.service.ts:75
    strictnessType: "material",   // strictness.service.ts:34 STRICTNESS_TYPE
  },
  strictness: {
    mergedLotPrefix: "IQC",       // strictness.service.ts:24-25 isMergedIncomingLot
    windowSize: 10,               // strictness.service.ts:202 (true sliding window limit 10)
    rejectWindowSize: 5,          // strictness.service.ts:205 (flags.slice(0,5))
    normalToTightenedRejectsIn5: 2,        // strictness.service.ts:219
    normalToReducedAllAcceptedIn10: 10,    // strictness.service.ts:227
    tightenedToNormalAcceptedStreak: 5,    // strictness.service.ts:240
    tightenedToSuspendedRejectedTotal: 5,  // strictness.service.ts:257
    reducedToExemptConsecutiveAccepted: 10,// strictness.service.ts:320 (manual, informational)
  },
  page: { defaultLimit: 50, maxLimit: 200 },
};


// -- GB/T 2828.1-2012 tables, verbatim from sampling-plan.service.ts:12-146 --

const BATCH_RANGES = [
  { min: 2,      max: 8,        letters: { 'S-1': 'A', 'S-2': 'A', 'S-3': 'A', 'S-4': 'A', I: 'A', II: 'A', III: 'B' } },
  { min: 9,      max: 15,       letters: { 'S-1': 'A', 'S-2': 'A', 'S-3': 'A', 'S-4': 'A', I: 'A', II: 'B', III: 'C' } },
  { min: 16,     max: 25,       letters: { 'S-1': 'A', 'S-2': 'A', 'S-3': 'B', 'S-4': 'B', I: 'B', II: 'C', III: 'D' } },
  { min: 26,     max: 50,       letters: { 'S-1': 'A', 'S-2': 'B', 'S-3': 'B', 'S-4': 'C', I: 'C', II: 'D', III: 'E' } },
  { min: 51,     max: 90,       letters: { 'S-1': 'B', 'S-2': 'B', 'S-3': 'C', 'S-4': 'C', I: 'C', II: 'E', III: 'F' } },
  { min: 91,     max: 150,      letters: { 'S-1': 'B', 'S-2': 'B', 'S-3': 'C', 'S-4': 'D', I: 'D', II: 'F', III: 'G' } },
  { min: 151,    max: 280,      letters: { 'S-1': 'B', 'S-2': 'C', 'S-3': 'D', 'S-4': 'E', I: 'E', II: 'G', III: 'H' } },
  { min: 281,    max: 500,      letters: { 'S-1': 'B', 'S-2': 'C', 'S-3': 'D', 'S-4': 'E', I: 'F', II: 'H', III: 'J' } },
  { min: 501,    max: 1200,     letters: { 'S-1': 'C', 'S-2': 'C', 'S-3': 'E', 'S-4': 'F', I: 'G', II: 'J', III: 'K' } },
  { min: 1201,   max: 3200,     letters: { 'S-1': 'C', 'S-2': 'D', 'S-3': 'E', 'S-4': 'G', I: 'H', II: 'K', III: 'L' } },
  { min: 3201,   max: 10000,    letters: { 'S-1': 'C', 'S-2': 'D', 'S-3': 'F', 'S-4': 'G', I: 'J', II: 'L', III: 'M' } },
  { min: 10001,  max: 35000,    letters: { 'S-1': 'C', 'S-2': 'D', 'S-3': 'F', 'S-4': 'H', I: 'K', II: 'M', III: 'N' } },
  { min: 35001,  max: 150000,   letters: { 'S-1': 'D', 'S-2': 'E', 'S-3': 'G', 'S-4': 'J', I: 'L', II: 'N', III: 'P' } },
  { min: 150001, max: 500000,   letters: { 'S-1': 'D', 'S-2': 'E', 'S-3': 'G', 'S-4': 'J', I: 'M', II: 'P', III: 'Q' } },
  { min: 500001, max: Infinity, letters: { 'S-1': 'D', 'S-2': 'E', 'S-3': 'H', 'S-4': 'K', I: 'N', II: 'Q', III: 'R' } },
];

const NORMAL_SAMPLE_SIZE = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32,
  H: 50, J: 80, K: 125, L: 200, M: 315, N: 500,
  P: 800, Q: 1250, R: 2000,
};

const TIGHTENED_SAMPLE_SIZE = {
  ...NORMAL_SAMPLE_SIZE, S: 3150,
};

const REDUCED_SAMPLE_SIZE = {
  A: 2, B: 2, C: 2, D: 3, E: 5, F: 8, G: 13,
  H: 20, J: 32, K: 50, L: 80, M: 125, N: 200,
  P: 315, Q: 500, R: 800,
};

const AQL_COLUMNS = [
  '0.010', '0.015', '0.025', '0.040', '0.065', '0.10', '0.15', '0.25',
  '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10',
  '15', '25', '40', '65', '100', '150', '250', '400', '650', '1000',
];

const NORMAL_TABLE = {
  //                    0.010 0.015 0.025 0.040 0.065 0.10  0.15  0.25  0.40  0.65  1.0   1.5   2.5   4.0   6.5   10    15    25    40    65    100   150   250   400   650   1000
  A: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  B: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  C: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  D: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  E: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  F: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[6,7],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  G: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  H: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  J: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  K: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22],[24,25], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  L: [                  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22],  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  M: [                  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  N: [                  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  P: [                  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  Q: [                  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  R: [                  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
};

const TIGHTENED_TABLE = {
  //                    0.010 0.015 0.025 0.040 0.065 0.10  0.15  0.25  0.40  0.65  1.0   1.5   2.5   4.0   6.5   10    15    25    40    65    100   150   250   400   650   1000
  A: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  B: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  C: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  D: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  E: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  F: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  G: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  H: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  J: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  K: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  L: [                  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  M: [                  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  N: [                  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28],[34,35], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  P: [                  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28],[34,35],[43,44], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  Q: [                  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28],[34,35], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  R: [                [0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28],[34,35], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  S: [                  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',[18,19],[22,23]],
};

const REDUCED_TABLE = {
  //                    0.010 0.015 0.025 0.040 0.065 0.10  0.15  0.25  0.40  0.65  1.0   1.5   2.5   4.0   6.5   10    15    25    40    65    100   150   250   400   650   1000
  A: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  B: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  C: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  D: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  E: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  F: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[5,6],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  G: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  H: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  J: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  K: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  L: [                  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  M: [                  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  N: [                  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  P: [                  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  Q: [                  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  R: [                [0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
};

const CODE_LETTERS_ORDER = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S'];


// ── Pure logic (no DB) ──────────────────────────────────────────────

function normalizeLevel(level) {                       // sampling-plan.service.ts:148-161
  const s = String(level || "II").trim().toUpperCase()
    .replace(/[ⅡⅡ]/g, "II").replace(/G-/, "").replace(/[-_\s]/g, "-");
  if (s === "S-1" || s === "S1") return "S-1";
  if (s === "S-2" || s === "S2") return "S-2";
  if (s === "S-3" || s === "S3") return "S-3";
  if (s === "S-4" || s === "S4") return "S-4";
  if (s === "I" || s === "1") return "I";
  if (s === "II" || s === "2" || s === "G2" || s === "GII") return "II";
  if (s === "III" || s === "3" || s === "G3" || s === "GIII") return "III";
  return "II";
}

function normalizeAql(aql) {                            // sampling-plan.service.ts:163-168
  const s = String(aql || "0.4").trim();
  const num = parseFloat(s);
  return AQL_COLUMNS.find((c) => parseFloat(c) === num) || s;
}

/**
 * GB/T 2828.1-2012 single sampling plan.
 * Port of SamplingPlanService.calculateSamplingPlan (sampling-plan.service.ts:215-294):
 * batch range -> code letter -> arrow resolution -> Ac/Re + sample size.
 */
export function calculateSampling({ qty, aql, inspectionLevel, strictness, defectQty } = {}) {
  const lotSize = Number(qty);
  if (!Number.isFinite(lotSize) || lotSize < 2) throw new Error("批量必须大于等于2"); // :221-223
  const level = normalizeLevel(inspectionLevel);                      // :225
  const aqlStr = normalizeAql(aql);                                   // :226
  const aqlIdx = AQL_COLUMNS.indexOf(aqlStr);                         // :227
  if (aqlIdx === -1) throw new Error(`不支持的AQL值: ${aql}`);         // :228-230
  const range = BATCH_RANGES.find((r) => lotSize >= r.min && lotSize <= r.max); // :233
  if (!range) throw new Error("批量超出计算范围");                     // :234-236
  const codeLetter = range.letters[level];                            // :237

  const mode = strictness === "tightened" ? "tightened" : strictness === "reduced" ? "reduced" : "normal"; // :388-389
  const sampleSizeMap = mode === "tightened" ? TIGHTENED_SAMPLE_SIZE : mode === "reduced" ? REDUCED_SAMPLE_SIZE : NORMAL_SAMPLE_SIZE; // :170-174
  const planTable = mode === "tightened" ? TIGHTENED_TABLE : mode === "reduced" ? REDUCED_TABLE : NORMAL_TABLE; // :176-180

  let currentLetter = codeLetter;
  let guard = 0;
  let ac = 0, re = 1, resolvedLetter = codeLetter;
  while (guard++ < 20) {                                              // :245
    const row = planTable[currentLetter];
    if (!row) break;
    const cell = row[aqlIdx];
    if (Array.isArray(cell)) {                                        // :249-262
      ac = cell[0]; re = cell[1]; resolvedLetter = currentLetter; break;
    }
    const letterIdx = CODE_LETTERS_ORDER.indexOf(currentLetter);      // :264
    if (cell === "↓") {                                                // :265-271
      if (letterIdx + 1 >= CODE_LETTERS_ORDER.length) break;
      currentLetter = CODE_LETTERS_ORDER[letterIdx + 1];
    } else if (cell === "↑") {                                         // :272-279
      if (letterIdx - 1 < 0) break;
      currentLetter = CODE_LETTERS_ORDER[letterIdx - 1];
    } else break;
  }
  const sampleSize = sampleSizeMap[resolvedLetter] || sampleSizeMap[codeLetter] || 2; // :251 / :283
  const planText = `${mode === "normal" ? "G-" : mode[0].toUpperCase() + mode.slice(1) + "-"}${level} / N=${sampleSize} / Ac=${ac} Re=${re}`;
  const out = { sampleSize, ac, re, planText, aql: aqlStr, level, lotSize, codeLetter: resolvedLetter, strictness: mode };
  if (defectQty !== undefined && defectQty !== null && defectQty !== "") {
    out.verdict = toNonNegativeNumber(defectQty) <= ac ? "pass" : "fail"; // iqc.service.ts:60-62
  }
  return out;
}

function toNonNegativeNumber(v) {                        // iqc.service.ts:43-49
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/**
 * Batch decision. Port of resolveRecordIsPass + summarizeRecordVerdicts
 * (iqc.service.ts:51-76): a record passes when defectQty <= Ac (Ac missing => 0),
 * the batch passes only when EVERY record passes. `isPass` from the client is
 * never trusted — it is re-derived here (:57-58).
 * Note: the source never emits 'hold'; kept in the return type for contract parity.
 */
export function computeDecision(records) {
  const items = Array.isArray(records) ? records : [];
  const failedItems = [];
  let totalDefects = 0;
  items.forEach((r, index) => {
    const defectQty = toNonNegativeNumber(r?.defectQty);
    const ac = toNonNegativeNumber(r?.ac);
    totalDefects += defectQty;
    if (defectQty > ac) {
      failedItems.push({ index, itemName: r?.itemName || `项目${index + 1}`, defectQty, ac });
    }
  });
  return { decision: failedItems.length ? "fail" : "pass", failedItems, totalDefects };
}

/**
 * Strictness state machine. Port of StrictnessService.onInspectionResult
 * (strictness.service.ts:187-300). `state` is the current DB row; optional
 * `window` overrides ({acceptedStreak, rejectedIn5, allAcceptedIn10}) let the
 * DB handler feed the REAL sliding window computed from the count ledger
 * (:192-212) instead of the heuristic derived from the persisted counters.
 */
export function computeStrictnessTransition(state, accepted, window = {}) {
  const from = state?.strictness || CONFIG.defaults.strictness;
  const to = from;
  const next = {
    strictness: from,
    consecutiveAccepted: toNonNegativeNumber(state?.consecutiveAccepted),
    recentRejectedIn5: toNonNegativeNumber(state?.recentRejectedIn5),
    tightenedRejectedTotal: toNonNegativeNumber(state?.tightenedRejectedTotal),
    tightenedConsecutiveAccepted: toNonNegativeNumber(state?.tightenedConsecutiveAccepted),
  };
  const ok = accepted === true;
  const acceptedStreak = Number.isFinite(window.acceptedStreak) ? window.acceptedStreak
    : (ok ? next.consecutiveAccepted + 1 : 0);
  const rejectedIn5 = Number.isFinite(window.rejectedIn5) ? window.rejectedIn5
    : Math.min(CONFIG.strictness.rejectWindowSize, Math.max(0, ok ? next.recentRejectedIn5 - 1 : next.recentRejectedIn5 + 1));
  const allAcceptedIn10 = typeof window.allAcceptedIn10 === "boolean" ? window.allAcceptedIn10
    : (ok && acceptedStreak >= CONFIG.strictness.normalToReducedAllAcceptedIn10);

  let toStrictness = from;
  let reason;

  if (from === "normal") {                                 // :218-236
    if (rejectedIn5 >= CONFIG.strictness.normalToTightenedRejectsIn5) {
      toStrictness = "tightened";
      reason = `近5批中有${rejectedIn5}批不接收，转为加严检验`;
      next.consecutiveAccepted = 0; next.recentRejectedIn5 = 0;
      next.tightenedRejectedTotal = 0; next.tightenedConsecutiveAccepted = 0;
    } else if (allAcceptedIn10) {
      toStrictness = "reduced";
      reason = "正常检验连续10批接收，转为放宽检验";
      next.consecutiveAccepted = 0; next.recentRejectedIn5 = 0;
    } else {
      next.consecutiveAccepted = acceptedStreak; next.recentRejectedIn5 = rejectedIn5;
    }
  } else if (from === "tightened") {                       // :237-261
    if (ok) {
      if (acceptedStreak >= CONFIG.strictness.tightenedToNormalAcceptedStreak) {
        toStrictness = "normal";
        reason = `加严检验连续${acceptedStreak}批接收，恢复正常检验`;
        next.tightenedConsecutiveAccepted = 0; next.tightenedRejectedTotal = 0;
        next.consecutiveAccepted = acceptedStreak;          // :245-247 keep streak
        next.recentRejectedIn5 = rejectedIn5;
      } else {
        next.tightenedConsecutiveAccepted = acceptedStreak;
      }
    } else {
      next.tightenedRejectedTotal = next.tightenedRejectedTotal + 1; // :252
      next.tightenedConsecutiveAccepted = 0;
      if (next.tightenedRejectedTotal >= CONFIG.strictness.tightenedToSuspendedRejectedTotal) {
        toStrictness = "suspended";
        reason = `加严检验累计${next.tightenedRejectedTotal}批不接收，暂停检验`;
      }
    }
  } else if (from === "reduced") {                         // :262-274
    if (!ok) {
      toStrictness = "normal";
      reason = "放宽检验出现1批不接收，恢复正常检验";
      next.consecutiveAccepted = 0; next.recentRejectedIn5 = rejectedIn5;
    } else {
      next.consecutiveAccepted = next.consecutiveAccepted + 1; // :271
      next.recentRejectedIn5 = rejectedIn5;
    }
  }
  // exempt/suspended: no automatic transition (source :152-155 skips counting entirely)

  next.strictness = toStrictness;
  const changed = toStrictness !== from;                    // :281
  return { ...next, changed, from, to: toStrictness, reason: reason || (changed ? "自动转移" : undefined) };
}


// ── DB route handlers ───────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => UUID_RE.test(String(v || ""));
const numParam = (v, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : def; };
const limitOf = (v) => Math.min(Math.max(numParam(v, CONFIG.page.defaultLimit), 1), CONFIG.page.maxLimit);
const offsetOf = (v) => Math.max(numParam(v, 0), 0);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) {
      if (res.headersSent) return;
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error("[rjvn-iqc]", e);
      res.status(status).json({ success: false, error: e.message || "Internal error" });
    }
  };
}

async function getStrictnessRow(client, materialId, withNames = false) {
  if (!isUuid(materialId)) return null;
  const sel = withNames
    ? `select s.*, m.material_code, m.material_name from public.rjvn_iqc_inspection_strictness s
       left join public.rjvn_material m on m.id = s.material_id where s.material_id = $1
       order by case when s.inspection_type = 'material' then 0 else 1 end, s._created_at desc limit 1`
    : `select * from public.rjvn_iqc_inspection_strictness where material_id = $1
       order by case when inspection_type = 'material' then 0 else 1 end, _created_at desc limit 1`;
  const r = await client.query(sel, [materialId]);
  return r.rows[0] || null;
}

export function registerRjvnIqcRoutes(app, pgPool, requirePermission) {
  const perm = requirePermission("wms.view");

  // Pending inspection lots. Source: iqc.service.ts:409-543 getPendingList.
  app.get("/rjvn-iqc/pending", perm, wrap(async (req, res) => {
    const q = String(req.query.q || "").slice(0, 200);
    // Parity with original iqc.service.ts getPendingList: no default status filter.
    // Optional ?status= narrows results when supplied; absent = all lots (original behavior).
    const status = String(req.query.status || "").slice(0, 80);
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const where = `($1::text is null or $1 = '' or
        coalesce(l.lot_no,'') ilike '%'||$1||'%' or
        coalesce(l.inspection_no,'') ilike '%'||$1||'%' or
        coalesce(l.batch_no,'') ilike '%'||$1||'%' or
        coalesce(m.material_code,'') ilike '%'||$1||'%' or
        coalesce(m.material_name,'') ilike '%'||$1||'%' or
        coalesce(s.supplier_name,'') ilike '%'||$1||'%')
      and ($2::text is null or $2 = '' or lower(coalesce(l.status,'')) = lower($2))`;
    const params = [q || null, status || null, limit, offset];
    const [data, count] = await Promise.all([
      pgPool.query(`select l.*, m.material_code, m.material_name, s.supplier_name,
        s.supplier_code, l._created_at as submitted_at,
        (select ro.keeper_id from public.rjvn_iqc_lot_receipt lr
           join public.rjvn_receipt_order ro on ro.id = lr.receipt_id
          where lr.lot_id = l.id limit 1) as keeper_id,
        false as is_exempt
        from public.rjvn_iqc_lot l
        left join public.rjvn_material m on m.id = l.material_id
        left join public.rjvn_supplier s on s.id = l.supplier_id
        where ${where}
        order by l.receipt_date desc nulls last, l.lot_no desc limit $3 offset $4`, params),
      pgPool.query(`select count(*)::int as n from public.rjvn_iqc_lot l
        left join public.rjvn_material m on m.id = l.material_id
        left join public.rjvn_supplier s on s.id = l.supplier_id where ${where}`, [q || null, status || null]),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n, limit, offset } });
  }));

  // Lot detail: lot + records + latest report + current strictness.
  // Source: iqc.service.ts:762-901 getLotDetail, :1574-1610 getLotRecords.
  app.get("/rjvn-iqc/lot/:id", perm, wrap(async (req, res) => {
    const id = req.params.id;
    if (!isUuid(id)) throw new HttpError(400, "Invalid lot id");
    const [lot, records, report, strictnessRows] = await Promise.all([
      pgPool.query(`select l.*, m.material_code, m.material_name, s.supplier_name
        from public.rjvn_iqc_lot l
        left join public.rjvn_material m on m.id = l.material_id
        left join public.rjvn_supplier s on s.id = l.supplier_id where l.id = $1 limit 1`, [id]),
      pgPool.query(`select * from public.rjvn_iqc_inspection_record where lot_id = $1
        order by sort_order nulls last, id`, [id]),
      pgPool.query(`select * from public.rjvn_iqc_report where lot_id = $1
        order by _created_at desc nulls last limit 1`, [id]),
      pgPool.query(`select * from public.rjvn_iqc_inspection_strictness where material_id =
        (select material_id from public.rjvn_iqc_lot where id = $1)
        order by case when inspection_type = 'material' then 0 else 1 end, _created_at desc`, [id]),
    ]);
    if (!lot.rowCount) throw new HttpError(404, "Lot not found");
    res.json({ success: true, data: {
      lot: lot.rows[0], records: records.rows,
      report: report.rows[0] || null,
      strictness: strictnessRows.rows[0] || null,
      strictnessRows: strictnessRows.rows, // extra: all types, for legacy data
    } });
  }));

  // Current strictness, one row per material (prefers inspection_type='material').
  // Source: strictness.service.ts:611-702 list, :764-794 getCurrentStrictness.
  app.get("/rjvn-iqc/strictness/current", perm, wrap(async (req, res) => {
    const materialId = req.query.materialId;
    const { rows } = await pgPool.query(`select distinct on (s.material_id)
        s.*, m.material_code, m.material_name
      from public.rjvn_iqc_inspection_strictness s
      left join public.rjvn_material m on m.id = s.material_id
      where ($1::uuid is null or s.material_id = $1)
      order by s.material_id, case when s.inspection_type = 'material' then 0 else 1 end, s._created_at desc`,
      [isUuid(materialId) ? materialId : null]);
    res.json({ success: true, data: { rows } });
  }));

  // Strictness ledger list.
  app.get("/rjvn-iqc/strictness/list", perm, wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const materialCode = String(req.query.materialCode || "").slice(0, 120);
    const materialName = String(req.query.materialName || "").slice(0, 120);
    const strictnessFilter = String(req.query.strictness || "").slice(0, 40);
    // Parity with strictness.service.ts list(): every received/stocked material
    // appears; materials without a strictness row get normal/II/0.40 defaults.
    const clauses = [`(
      exists (select 1 from public.rjvn_receipt_order ro where ro.material_id = m.id)
      or exists (select 1 from public.rjvn_inventory inv where inv.material_id = m.id)
      or s.id is not null)`];
    const params = [];
    const add = (sql, v) => { params.push(v); clauses.push(sql.replace("$P", `$${params.length}`)); };
    if (materialCode) add(`coalesce(m.material_code,'') ilike '%'||$P||'%'`, materialCode);
    if (materialName) add(`coalesce(m.material_name,'') ilike '%'||$P||'%'`, materialName);
    if (strictnessFilter) add(`coalesce(s.strictness,'normal') = $P`, strictnessFilter);
    const where = clauses.join(" and ");
    const sel = `coalesce(s.id::text, m.id::text) as id, m.id as material_id,
      m.material_code, m.material_name, 'material' as inspection_type,
      coalesce(s.strictness,'normal') as strictness,
      coalesce(s.inspection_level,'II') as inspection_level,
      coalesce(s.aql,'0.40') as aql,
      coalesce(s.consecutive_accepted,0) as consecutive_accepted,
      coalesce(s.recent_rejected_in_5,0) as recent_rejected_in_5,
      coalesce(s.tightened_rejected_total,0) as tightened_rejected_total,
      coalesce(s.tightened_consecutive_accepted,0) as tightened_consecutive_accepted,
      s.exception_source, s.remark, s._created_at, s._updated_at`;
    const from = `from public.rjvn_material m
      left join public.rjvn_iqc_inspection_strictness s
        on s.material_id = m.id and s.inspection_type = 'material'
      where ${where}`;
    const [data, count] = await Promise.all([
      pgPool.query(`select ${sel} ${from} order by s._updated_at desc nulls last, m.material_code limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, limit, offset]),
      pgPool.query(`select count(*)::int as n ${from}`, params),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n } });
  }));

  // Strictness transfer log. Source: strictness.service.ts:707-759 getTransferLogs.
  app.get("/rjvn-iqc/strictness/transfer-logs", perm, wrap(async (req, res) => {
    const materialId = req.query.materialId;
    const limit = limitOf(req.query.limit);
    const where = materialId && isUuid(materialId) ? "where l.material_id = $1" : "";
    const p = where ? [materialId, limit] : [limit];
    const [data, count] = await Promise.all([
      pgPool.query(`select l.*, m.material_code, m.material_name
        from public.rjvn_iqc_strictness_transfer_log l
        left join public.rjvn_material m on m.id = l.material_id
        ${where} order by l._created_at desc nulls last limit $${where ? 2 : 1}`, p),
      pgPool.query(`select count(*)::int as n from public.rjvn_iqc_strictness_transfer_log l ${where}`,
        where ? [materialId] : []),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n } });
  }));

  // Sampling plan calculator. Source: sampling-plan.service.ts:215-294.
  app.get("/rjvn-iqc/sampling/calculate", perm, wrap(async (req, res) => {
    let qty = req.query.qty, aql = req.query.aql;
    let inspectionLevel = req.query.inspectionLevel, strictness = req.query.strictness;
    if (isUuid(req.query.lotId)) {
      const l = await pgPool.query(`select l.total_qty, s.aql, s.inspection_level, s.strictness
        from public.rjvn_iqc_lot l
        left join public.rjvn_iqc_inspection_strictness s on s.material_id = l.material_id
          and s.inspection_type = 'material'
        where l.id = $1 order by s._created_at desc limit 1`, [req.query.lotId]);
      if (!l.rowCount) throw new HttpError(404, "Lot not found");
      if (qty === undefined || qty === "") qty = l.rows[0].total_qty;
      if (!aql) aql = l.rows[0].aql;
      if (!inspectionLevel) inspectionLevel = l.rows[0].inspection_level;
      if (!strictness) strictness = l.rows[0].strictness;
    }
    const plan = calculateSampling({
      qty, aql: aql || CONFIG.defaults.aql,
      inspectionLevel: inspectionLevel || CONFIG.defaults.inspectionLevel,
      strictness: strictness || CONFIG.defaults.strictness,
      defectQty: req.query.defectQty,
    });
    res.json({ success: true, data: plan });
  }));


  // Submit an inspection: records + report + strictness ledger + transfer log
  // + lot status, all in ONE transaction.
  // Source: iqc.service.ts:1290-1501 submitInspection, :2358-2373 approval side effect;
  // strictness.service.ts:143-302 onInspectionResult.
  app.post("/rjvn-iqc/inspect/:lotId", perm, wrap(async (req, res) => {
    const lotId = req.params.lotId;
    if (!isUuid(lotId)) throw new HttpError(400, "Invalid lot id");
    const rawRecords = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!rawRecords.length) throw new HttpError(400, "检验记录为空，不能提交"); // iqc.service.ts:1342-1349
    const inspector = req.body?.inspector == null ? "" : String(req.body.inspector).slice(0, 100);

    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");

      // Lock the lot; guard terminal states (iqc.service.ts:1393-1412).
      const lotRes = await client.query(`select id, material_id, lot_no, inspection_no, total_qty,
        inspection_result, status from public.rjvn_iqc_lot where id = $1 for update`, [lotId]);
      if (!lotRes.rowCount) throw new HttpError(404, "检验批次不存在");
      const lot = lotRes.rows[0];
      if (["pass", "fail"].includes(String(lot.inspection_result || "").toLowerCase())) {
        throw new HttpError(400, "该批次已完成检验，不可重复提交");
      }
      if (!isUuid(lot.material_id)) throw new HttpError(400, "批次缺少有效物料");

      // getOrCreate strictness row (strictness.service.ts:48-80).
      let strict = await getStrictnessRow(client, lot.material_id);
      if (!strict) {
        await client.query(`insert into public.rjvn_iqc_inspection_strictness
          (material_id, inspection_type, strictness, inspection_level, aql)
          values ($1, $2, $3, $4, $5)`,
          [lot.material_id, CONFIG.defaults.strictnessType, CONFIG.defaults.strictness,
           CONFIG.defaults.inspectionLevel, CONFIG.defaults.aql]);
        strict = await getStrictnessRow(client, lot.material_id);
      }
      if (strict.strictness === "suspended") {
        throw new HttpError(400, "该物料检验已暂停，不能提交检验"); // iqc.service.ts:1315-1319
      }

      // Derive Ac (missing from the wire contract) from the sampling plan, then
      // derive isPass from defectQty <= Ac — never trust the client's isPass.
      // Source: iqc.service.ts:51-76, sampling-plan.service.ts:351-410.
      const ctx = {
        qty: lot.total_qty,
        aql: strict.aql || CONFIG.defaults.aql,
        level: strict.inspection_level || CONFIG.defaults.inspectionLevel,
        strictness: strict.strictness || CONFIG.defaults.strictness,
      };
      const prepared = rawRecords.map((r, i) => {
        let ac = r.ac;
        if (ac === undefined || ac === null || ac === "" || !Number.isFinite(Number(ac))) {
          try {
            ac = calculateSampling({
              qty: ctx.qty, aql: r.AQL ?? r.aql ?? ctx.aql,
              inspectionLevel: ctx.level, strictness: ctx.strictness,
            }).ac;
          } catch { ac = 0; }
        }
        ac = toNonNegativeNumber(ac);
        return {
          itemName: String(r.itemName || `项目${i + 1}`),
          sectionType: r.sectionType || "",
          standard: r.standard ?? null,
          specMin: r.specMin ?? null,
          specMax: r.specMax ?? null,
          unit: r.unit ?? null,
          measuredValue: r.measuredValue ?? null,
          defectDescription: r.defectDescription ?? null,
          defectQty: toNonNegativeNumber(r.defectQty),
          isPass: toNonNegativeNumber(r.defectQty) <= ac,
          sortOrder: Number.isFinite(Number(r.sortOrder)) ? Number(r.sortOrder) : i + 1,
          samplingPlanText: r.samplingPlanText ?? null,
          aql: r.AQL ?? r.aql ?? ctx.aql,
          sampleSize: r.sampleSize ?? null,
          ac, re: r.re ?? null,
          templateItemId: isUuid(r.templateItemId) ? r.templateItemId : null,
        };
      });
      const decisionInfo = computeDecision(prepared);
      const decision = decisionInfo.decision;
      const accepted = decision === "pass";

      // 1) insert inspection records (iqc.service.ts:1457-1488).
      // The mirror is append-only (no DELETE grant, repo rule: no hard-deletes).
      // The terminal-state guard above plus this transaction's rollback on any
      // error make a duplicate submit impossible, so no delete/replace is needed.
      for (const rec of prepared) {
        await client.query(`insert into public.rjvn_iqc_inspection_record
          (lot_id, item_name, section_type, standard, spec_min, spec_max, unit,
           measured_value, defect_description, defect_qty, is_pass, sort_order,
           sampling_plan_text, aql, sample_size, ac, re, template_item_id)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [lotId, rec.itemName, rec.sectionType, rec.standard, rec.specMin, rec.specMax,
           rec.unit, rec.measuredValue, rec.defectDescription, rec.defectQty, rec.isPass,
           rec.sortOrder, rec.samplingPlanText, rec.aql, rec.sampleSize, rec.ac, rec.re,
           rec.templateItemId]);
      }

      // 2) report upsert (iqc.service.ts:1415-1455). inspector_id is a 0-field
      // composite (rjvn_user_profile), so the name is kept in remark instead.
      const remark = [`decision=${decision}`, inspector ? `inspector:${inspector}` : null,
        decisionInfo.failedItems.length ? `failed=${decisionInfo.failedItems.length}` : null]
        .filter(Boolean).join(" | ");
      const existing = await client.query(`select id from public.rjvn_iqc_report
        where lot_id = $1 order by _created_at desc limit 1`, [lotId]);
      let reportId;
      if (existing.rowCount) {
        reportId = existing.rows[0].id;
        await client.query(`update public.rjvn_iqc_report set final_result = $1,
          inspection_time = now(), review_status = 'pending', remark = $2,
          judge_mode = 'inspection', _updated_at = now() where id = $3`,
          [decision, remark, reportId]);
      } else {
        const ins = await client.query(`insert into public.rjvn_iqc_report
          (lot_id, report_no, final_result, inspection_time, review_status, remark, judge_mode)
          values ($1,$2,$3,now(),'pending',$4,'inspection') returning id`,
          [lotId, lot.inspection_no || null, decision, remark]);
        reportId = ins.rows[0].id;
      }

      // 3) strictness count ledger — only merged incoming lots (IQC*) are counted;
      // explicit existence check gives the same idempotency as onConflictDoNothing
      // (strictness.service.ts:24-25, :157-185). The mirror has no unique constraint.
      let counted = false;
      const isMerged = String(lot.lot_no || "").startsWith(CONFIG.strictness.mergedLotPrefix);
      if (isMerged) {
        const dup = await client.query(`select id from public.rjvn_iqc_lot_strictness_count
          where lot_id = $1 and inspection_type = $2 limit 1`,
          [lotId, CONFIG.defaults.strictnessType]);
        if (!dup.rowCount) {
          await client.query(`insert into public.rjvn_iqc_lot_strictness_count
            (lot_id, material_id, inspection_type, accepted, strictness_at_count)
            values ($1,$2,$3,$4,$5)`,
            [lotId, lot.material_id, CONFIG.defaults.strictnessType, accepted, strict.strictness]);
          counted = true;
        }
      }

      // 4) recompute state from the TRUE sliding window of the last 10 reports
      // (strictness.service.ts:187-300).
      let transition = { ...strict, changed: false, from: strict.strictness, to: strict.strictness };
      let transfer = null;
      if (counted) {
        const win = await client.query(`select accepted from public.rjvn_iqc_lot_strictness_count
          where material_id = $1 and inspection_type = $2
          order by _created_at desc, id desc limit $3`,
          [lot.material_id, CONFIG.defaults.strictnessType, CONFIG.strictness.windowSize]);
        const flags = win.rows.map((r) => !!r.accepted); // index 0 = newest
        let acceptedStreak = 0;
        for (const f of flags) { if (!f) break; acceptedStreak += 1; }
        const rejectedIn5 = flags.slice(0, CONFIG.strictness.rejectWindowSize)
          .filter((v) => !v).length;
        const allAcceptedIn10 = flags.length >= CONFIG.strictness.normalToReducedAllAcceptedIn10
          && flags.slice(0, CONFIG.strictness.normalToReducedAllAcceptedIn10).every(Boolean);
        transition = computeStrictnessTransition(strict, accepted,
          { acceptedStreak, rejectedIn5, allAcceptedIn10 });

        await client.query(`update public.rjvn_iqc_inspection_strictness set
          strictness = $1, consecutive_accepted = $2, recent_rejected_in_5 = $3,
          tightened_rejected_total = $4, tightened_consecutive_accepted = $5,
          _updated_at = now() where id = $6`,
          [transition.strictness, transition.consecutiveAccepted, transition.recentRejectedIn5,
           transition.tightenedRejectedTotal, transition.tightenedConsecutiveAccepted, strict.id]);

        if (transition.changed) { // :281-293
          const tr = await client.query(`insert into public.rjvn_iqc_strictness_transfer_log
            (material_id, inspection_type, from_strictness, to_strictness, transfer_type,
             report_id, lot_id, reason)
            values ($1,$2,$3,$4,'auto',$5,$6,$7) returning *`,
            [lot.material_id, CONFIG.defaults.strictnessType, transition.from, transition.to,
             reportId, lotId, transition.reason || "自动转移"]);
          transfer = tr.rows[0];
        }
      }

      // 5) lot conclusion. submitInspection sets review_pending (:1388); this port
      // combines submit+approval, so the terminal result is written directly.
      await client.query(`update public.rjvn_iqc_lot set inspection_result = $1,
        status = $1, inspection_time = now(), _updated_at = now() where id = $2`,
        [decision, lotId]);

      await client.query("COMMIT");
      res.json({ success: true, data: {
        reportId, decision, counted,
        failedItems: decisionInfo.failedItems,
        totalDefects: decisionInfo.totalDefects,
        strictnessUpdate: {
          materialId: lot.material_id, counted, ...transition,
        },
        transfer,
      } });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* ignore rollback failure */ }
      throw e;
    } finally {
      client.release();
    }
  }));

  // IQC KPI stats over the mirror tables.
  app.get("/rjvn-iqc/stats", perm, wrap(async (req, res) => {
    const [totals, byStrictness] = await Promise.all([
      pgPool.query(`select count(*)::int as lots,
        count(*) filter (where lower(coalesce(inspection_result,'')) = 'pending')::int as pending,
        count(*) filter (where lower(coalesce(inspection_result,'')) = 'pass')::int as passed,
        count(*) filter (where lower(coalesce(inspection_result,'')) in ('fail','reject','hold'))::int as failed
        from public.rjvn_iqc_lot`),
      pgPool.query(`select strictness as name, count(*)::int as value
        from public.rjvn_iqc_inspection_strictness group by strictness order by value desc`),
    ]);
    const t = totals.rows[0];
    const judged = t.passed + t.failed;
    res.json({ success: true, data: {
      lots: t.lots, pending: t.pending, passed: t.passed, failed: t.failed,
      passRate: judged ? Math.round((t.passed / judged) * 10000) / 100 : 0,
      byStrictness: byStrictness.rows,
    } });
  }));
}
