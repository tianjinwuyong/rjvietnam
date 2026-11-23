// Factory floor plan: zones, work spots and the aisle waypoint graph.
// Pure data + routing math (no three.js) so behavior.ts stays framework-free.
// Floor is 40 x 28 units: x in [-20, 20], z in [-14, 14].
// Characters only ever walk aisle lanes + open zone corridors, never through racks.

export interface Vec2 { x: number; z: number }

export type ZoneId =
  | "warehouse" | "receiving" | "quality" | "smt" | "packing"
  | "pmc" | "office" | "maintenance" | "it" | "cmd";

export interface ZoneDef {
  id: ZoneId;
  labelKey: string;
  /** tint used for the zone pad + signage */
  color: string;
  rect: { x: number; z: number; w: number; d: number };
  /** waypoint-graph node where the zone meets the aisle network */
  entryNode: string;
  /** x of the open in-zone corridor used for L-shaped local routes */
  corridorX: number;
  spots: Vec2[];
  /** where the flat floor sign is painted */
  sign: Vec2;
}

export const DOMAIN_COLORS: Record<string, string> = {
  wms: "#3b82f6",        // blue
  quality: "#22c55e",    // green
  mes: "#f97316",        // orange
  pmc: "#a855f7",        // purple
  procurement: "#06b6d4",// cyan
  maintenance: "#64748b",// slate
  finance: "#eab308",    // gold
  hr: "#ec4899",         // pink
  it: "#14b8a6",         // teal
  cmd: "#ef4444",        // red
  oa: "#a3e635",         // lime
  supplier: "#818cf8",   // indigo
};

export function domainColor(domain: string): string {
  return DOMAIN_COLORS[domain] ?? "#94a3b8";
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  warehouse: {
    id: "warehouse", labelKey: "zone.warehouse", color: DOMAIN_COLORS.wms,
    rect: { x: -19, z: -12, w: 12, d: 12 },
    entryNode: "wEntry", corridorX: -8.2,
    spots: [
      { x: -16.5, z: -9 }, { x: -13.5, z: -9 }, { x: -10.5, z: -9 },
      { x: -16.5, z: -6 }, { x: -13.5, z: -6 }, { x: -10.5, z: -6 },
      { x: -16.5, z: -3 }, { x: -13.5, z: -3 },
    ],
    sign: { x: -13, z: -1.2 },
  },
  receiving: {
    id: "receiving", labelKey: "zone.receiving", color: DOMAIN_COLORS.procurement,
    rect: { x: -20, z: 4, w: 6, d: 8 },
    entryNode: "r0", corridorX: -14.6,
    spots: [{ x: -18, z: 6.5 }, { x: -18, z: 9 }, { x: -16, z: 10.5 }],
    sign: { x: -17, z: 4.7 },
  },
  quality: {
    id: "quality", labelKey: "zone.quality", color: DOMAIN_COLORS.quality,
    rect: { x: -4, z: -12.5, w: 9, d: 6 },
    entryNode: "qEntry", corridorX: 0.5,
    spots: [
      { x: -2.5, z: -10.5 }, { x: -2.5, z: -8 }, { x: 0.5, z: -11 },
      { x: 2.5, z: -10.5 }, { x: 2.5, z: -8 }, { x: 0.5, z: -7 },
    ],
    sign: { x: 0.5, z: -6.2 },
  },
  smt: {
    id: "smt", labelKey: "zone.smt", color: DOMAIN_COLORS.mes,
    rect: { x: 1, z: -4.5, w: 12, d: 8.5 },
    entryNode: "mesEntry", corridorX: 5.8,
    spots: [
      { x: 2.2, z: -2.2 }, { x: 7, z: -2.2 }, { x: 11.8, z: -2.2 },
      { x: 2.2, z: 0.8 }, { x: 7, z: 0.8 }, { x: 11.8, z: 0.8 },
      { x: 2.2, z: 3.8 }, { x: 7, z: 3.8 },
    ],
    sign: { x: 7, z: -4.9 },
  },
  packing: {
    id: "packing", labelKey: "zone.packing", color: DOMAIN_COLORS.mes,
    rect: { x: 15.5, z: -5.5, w: 4, d: 9.5 },
    entryNode: "pEntry", corridorX: 14.7,
    spots: [{ x: 16.5, z: -3.5 }, { x: 16.5, z: 0 }, { x: 16.5, z: 2.5 }, { x: 18.5, z: -1.5 }],
    sign: { x: 17.5, z: -5.9 },
  },
  pmc: {
    id: "pmc", labelKey: "zone.pmc", color: DOMAIN_COLORS.pmc,
    rect: { x: 15, z: 6.5, w: 5, d: 6.5 },
    entryNode: "pmcEntry", corridorX: 14.6,
    spots: [{ x: 16.5, z: 8 }, { x: 18.5, z: 8 }, { x: 16.5, z: 11 }],
    sign: { x: 17.5, z: 6.1 },
  },
  office: {
    id: "office", labelKey: "zone.office", color: "#94a3b8",
    rect: { x: -1, z: 7.5, w: 12, d: 6 },
    entryNode: "officeEntry", corridorX: 5,
    spots: [
      { x: 0, z: 9 }, { x: 2, z: 9 }, { x: 0, z: 11.5 }, { x: 2, z: 11.5 },
      { x: 4.5, z: 9 }, { x: 6.5, z: 9 }, { x: 8.5, z: 9 }, { x: 10, z: 11.5 },
    ],
    sign: { x: 5, z: 13.1 },
  },
  maintenance: {
    id: "maintenance", labelKey: "zone.maintenance", color: DOMAIN_COLORS.maintenance,
    rect: { x: -13, z: 7.5, w: 6, d: 6 },
    entryNode: "maintEntry", corridorX: -10,
    spots: [
      { x: -11.5, z: 9 }, { x: -8.5, z: 9 }, { x: -11.5, z: 11.5 },
      { x: -8.5, z: 11.5 }, { x: -10, z: 10.2 },
    ],
    sign: { x: -10, z: 7.1 },
  },
  it: {
    id: "it", labelKey: "zone.it", color: DOMAIN_COLORS.it,
    rect: { x: 15, z: -12.5, w: 4.5, d: 5.5 },
    entryNode: "itEntry", corridorX: 14.6,
    spots: [
      { x: 16, z: -11.5 }, { x: 17.5, z: -11.5 }, { x: 19, z: -11.5 },
      { x: 16, z: -10 }, { x: 17.5, z: -10 }, { x: 19, z: -10 },
      { x: 16, z: -8.5 }, { x: 17.5, z: -8.5 }, { x: 19, z: -8.5 },
      { x: 16, z: -7.6 }, { x: 17.5, z: -7.6 }, { x: 19, z: -7.6 },
    ],
    sign: { x: 17.2, z: -6.7 },
  },
  cmd: {
    id: "cmd", labelKey: "zone.cmd", color: DOMAIN_COLORS.cmd,
    rect: { x: -6, z: 1, w: 6, d: 5 },
    entryNode: "cmdEntry", corridorX: -1.2,
    spots: [{ x: -1.5, z: 2 }, { x: -4.8, z: 1.6 }, { x: -3, z: 4.8 }],
    sign: { x: -3.6, z: 1.4 },
  },
};

/** Which zone an employee lives in. MES staff split between the lines and packing. */
export function zoneForEmployee(id: string, domain: string): ZoneId {
  switch (domain) {
    case "wms": return "warehouse";
    case "procurement":
    case "supplier": return "receiving";
    case "quality": return "quality";
    case "mes": return hashSeed(id) % 4 === 0 ? "packing" : "smt";
    case "pmc": return "pmc";
    case "finance":
    case "hr":
    case "oa": return "office";
    case "maintenance": return "maintenance";
    case "it": return "it";
    case "cmd": return "cmd";
    default: return "office";
  }
}

/** Cross-zone errands give the aisle network visible traffic (seeded choice at runtime). */
export const ERRAND_ZONES: Record<ZoneId, ZoneId[]> = {
  warehouse: ["quality", "receiving", "smt"],
  receiving: ["warehouse", "quality"],
  quality: ["warehouse", "receiving"],
  smt: ["warehouse", "quality", "packing"],
  packing: ["smt", "warehouse"],
  pmc: ["smt", "warehouse", "office"],
  office: ["pmc", "cmd"],
  maintenance: ["smt", "it"],
  it: ["office", "cmd"],
  cmd: ["warehouse", "receiving", "quality", "smt", "packing", "pmc", "office", "maintenance", "it"],
};

// ---------------------------------------------------------------------------
// Aisle waypoint graph
// ---------------------------------------------------------------------------

export const NODES: Record<string, Vec2> = {
  r0: { x: -14.6, z: 5.5 }, rEntry: { x: -13, z: 5.5 }, mW: { x: -10, z: 5.5 },
  jWA: { x: -5.5, z: 5.5 }, cmdEntry: { x: -3, z: 5.5 }, officeEntry: { x: 5, z: 5.5 }, jEA: { x: 14, z: 5.5 },
  jW2: { x: -5.5, z: 1.8 }, wEntry: { x: -8.2, z: 1.8 },
  jWS: { x: -5.5, z: 12.5 }, jWC: { x: -5.5, z: -5.4 }, jWN: { x: -5.5, z: -13.3 },
  qEntry: { x: 0.5, z: -5.4 }, mesEntry: { x: 5.8, z: -5.4 }, jEC: { x: 14, z: -5.4 },
  jE0: { x: 14, z: 0 }, pEntry: { x: 14.7, z: 0 },
  jE1: { x: 14, z: -9.5 }, itEntry: { x: 14.6, z: -9.5 },
  jEN: { x: 14, z: -13.3 }, jE2: { x: 14, z: 9.5 }, pmcEntry: { x: 14.6, z: 9.5 }, jES: { x: 14, z: 12.5 },
  maintEntry: { x: -10, z: 6.8 },
};

export const EDGES: Array<[string, string]> = [
  ["r0", "rEntry"], ["rEntry", "mW"], ["mW", "jWA"], ["jWA", "cmdEntry"],
  ["cmdEntry", "officeEntry"], ["officeEntry", "jEA"],
  ["jWA", "jW2"], ["jW2", "wEntry"], ["jWA", "jWS"], ["jWA", "jWC"], ["jWC", "jWN"],
  ["jWC", "qEntry"], ["qEntry", "mesEntry"], ["mesEntry", "jEC"],
  ["jEA", "jE0"], ["jE0", "jEC"], ["jEC", "jE1"], ["jE1", "jEN"],
  ["jEA", "jE2"], ["jE2", "jES"], ["jWN", "jEN"],
  ["jE0", "pEntry"], ["jE1", "itEntry"], ["jE2", "pmcEntry"], ["mW", "maintEntry"],
];

const ADJACENCY: Record<string, string[]> = (() => {
  const adj: Record<string, string[]> = {};
  for (const id of Object.keys(NODES)) adj[id] = [];
  for (const [a, b] of EDGES) { adj[a].push(b); adj[b].push(a); }
  return adj;
})();

/** BFS shortest aisle path between two graph nodes (graph is tiny; called on transitions only). */
export function aislePath(fromNode: string, toNode: string): Vec2[] {
  if (fromNode === toNode) return [NODES[fromNode]];
  const prev: Record<string, string | null> = { [fromNode]: null };
  const queue: string[] = [fromNode];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === toNode) break;
    for (const next of ADJACENCY[cur]) {
      if (!(next in prev)) { prev[next] = cur; queue.push(next); }
    }
  }
  if (!(toNode in prev)) return [NODES[fromNode], NODES[toNode]];
  const path: Vec2[] = [];
  let cur: string | null = toNode;
  while (cur) { path.unshift(NODES[cur]); cur = prev[cur]; }
  return path;
}

/** Open-corridor route between a zone spot and its aisle entry node (spot -> corridorX -> entry). */
function localRoute(zone: ZoneDef, spot: Vec2): Vec2[] {
  const entry = NODES[zone.entryNode];
  return [spot, { x: zone.corridorX, z: spot.z }, { x: zone.corridorX, z: entry.z }, entry];
}

function pushUnique(out: Vec2[], pts: Vec2[]) {
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.z - p.z) > 0.01) out.push(p);
  }
}

/** Full walking route: spot -> zone corridor -> aisle graph -> target corridor -> target spot. */
export function routeBetween(fromZone: ZoneId, fromSpot: Vec2, toZone: ZoneId, toSpot: Vec2): Vec2[] {
  const a = ZONES[fromZone];
  const b = ZONES[toZone];
  const out: Vec2[] = [];
  pushUnique(out, localRoute(a, fromSpot));
  if (fromZone !== toZone) pushUnique(out, aislePath(a.entryNode, b.entryNode));
  pushUnique(out, localRoute(b, toSpot).reverse());
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Stable string hash (xmur3-style) so every employee gets reproducible "personality". */
export function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Short badge id: 'WMS-RECEIVING-VIRTUAL-01' -> 'WR-01', 'IQC-VIRTUAL-01' -> 'IQC-01'. */
export function shortId(id: string): string {
  const parts = id.split("-").filter(Boolean);
  const num = parts[parts.length - 1] ?? "";
  const words = parts.filter(p => p !== "VIRTUAL" && p !== num);
  if (words.length === 0) return id.slice(0, 8);
  if (words.length === 1) return `${words[0].slice(0, 4)}-${num}`;
  return `${words.map(w => w[0]).join("").slice(0, 3)}-${num}`;
}
