import React from "react";
import { createRoot } from "react-dom/client";
import StationTopology from "./StationTopology.js";

const root = createRoot(document.getElementById("root")!);
root.render(<React.StrictMode><StationTopology /></React.StrictMode>);
