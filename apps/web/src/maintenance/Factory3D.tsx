// The 3D factory map used to be an iframe into the standalone :5179 Vite
// process (only ever launched by start_dev.js with DEV_SERVICES including
// factory3d) — every other deployment showed a dead "Loading 3D Factory..."
// shell. The scene is plain three.js bound to the page's own React, so it
// renders in-process now; the lazy() boundary in App.tsx keeps the three
// chunk out of the main bundle.
import IsolatedFactory3D from "./IsolatedFactory3D";

export default function Factory3D() {
  return <IsolatedFactory3D />;
}
