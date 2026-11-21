// Station credential for this terminal.
//
// Copy this file to `station-config.js` beside it (`apps/station-agent/public/` in
// source, the dist root on a terminal) and paste the factory's STATION_LOGIN_KEY
// value into stationKey below. It is loaded as a plain script before the app
// bundle, so the key is never baked into a build or committed to git.
//
// What it proves is the *device*, not the person: the operator's own username and
// the station code still travel in the body of /auth/station-login, and the role
// policy in services/api/src/auth/station-login-policy.js still refuses office
// accounts there. Anyone who can open DevTools on this terminal can read this
// value, which is exactly why it only buys station-login.
//
// If the factory sets STATION_LOGIN_KEY and this file is missing or empty, the
// server answers 401 STATION_KEY_MISSING and the terminal cannot sign in.
globalThis.__STATION_AGENT__ = {
  stationKey: "",
};
