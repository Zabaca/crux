import { D1_SCHEMA_STATEMENTS, D1_ADD_COLUMNS } from "@crux/core/db/d1";
import { d1Module } from "../../modules/d1";

// The cloud corpus. `cloud.ts` imports this instance, so `zbc apply production`
// converges the schema before it deploys the Worker that reads it.
//
// The DDL is not duplicated here: it is the same `D1_SCHEMA_STATEMENTS` the
// Worker's own `applyD1Schema()` and the workerd tests use, so a table added to
// the schema module reaches production without a second edit. That single
// definition is what `workers-test/d1-schema.workerd.ts` guards.
//
// The database itself predates this instance — it was created by hand with
// `wrangler d1 create crux-production` before a D1 module existed. The module
// finds it by name and adopts it; `apps/cloud/wrangler.jsonc` stays the source
// of truth for the binding, and the id there must match this database.
export default d1Module.instance({
  name: "db",
  config: {
    accountId: "99a19e584439be0568f33aad0477372b",
    databaseName: "crux-production",
    statements: [...D1_SCHEMA_STATEMENTS],
    additiveColumns: [...D1_ADD_COLUMNS],
  },
});
