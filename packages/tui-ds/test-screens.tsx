import React from "react";
import { renderToString } from "ink";
import { WorkstreamDashboard } from "./src/screens/WorkstreamDashboard.js";
import { ProblemDetail } from "./src/screens/ProblemDetail.js";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

console.log("=== WorkstreamDashboard (cols:120) ===\n");
console.log(strip(renderToString(<WorkstreamDashboard />, { columns: 120 })));

console.log("\n=== ProblemDetail (cols:120) ===\n");
console.log(strip(renderToString(<ProblemDetail />, { columns: 120 })));
