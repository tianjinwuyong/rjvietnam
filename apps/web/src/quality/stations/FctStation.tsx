import { useState } from "react";
import type { Locale } from "../../../../../packages/shared-types/src/factory";

export function FctStation({ locale }: { locale: Locale }) {
  const [count, setCount] = useState(0);
  return (
    <div style={{ padding: 24, color: "#fff" }}>
      <h2 style={{ color: "#00d4ff" }}>FCT Station</h2>
      <p>Locale: {locale}</p>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)} style={{ padding: "8px 16px", background: "#00d4ff", border: "none", borderRadius: 6, cursor: "pointer" }}>
        Increment
      </button>
    </div>
  );
}
