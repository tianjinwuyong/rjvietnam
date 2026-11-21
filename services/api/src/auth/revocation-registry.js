// The process-wide revocation list, in its own module so every verifier shares
// ONE instance. Two copies of this Set would mean a token revoked by the SMT
// routes still opening the OA routes in the same process -- the exact hole the
// table was added to close.
import { createRevocationStore } from "./session-tokens.js";

export const revokedTokens = createRevocationStore();

/**
 * @param {{ jti?: string, exp?: number } | null | undefined} payload
 * @returns {boolean} true when that token was signed out and has not yet expired
 */
export function isRevokedToken(payload) {
  return revokedTokens.has(payload?.jti);
}
