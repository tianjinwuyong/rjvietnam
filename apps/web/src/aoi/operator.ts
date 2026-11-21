// Who an AOI inspection belongs to.
//
// The AOI screen writes two records for one board: the AOI record and the MES
// event, and the MES event is the source of truth for the line. They used to
// disagree — the record carried the signed-in user while the event hardcoded
// "VN_OP_001" — so every AOI pass on the line was attributed to one operator
// regardless of who was standing there. One resolver, both writes.
//
// Empty is allowed and means "nobody was identified": that is a visible data
// quality problem, whereas inventing an operator quietly frames someone for a
// board they never touched.

export interface OperatorSource {
  operator?: string | null;
}

/** The scanned board first (it carries the operator who loaded it), then the session. */
export function resolveOperator(board: OperatorSource | null, signedInUser: string | null | undefined): string {
  const fromBoard = String(board?.operator ?? "").trim();
  if (fromBoard) return fromBoard;
  return String(signedInUser ?? "").trim();
}
