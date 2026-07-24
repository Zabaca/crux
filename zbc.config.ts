import { defineConfig } from "@crux/infra";

// Production only — cloud crux has no preview environment (ADR-0004).
export default defineConfig({
  project: "crux",
  environments: ["production"],
});
