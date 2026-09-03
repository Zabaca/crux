/**
 * A D1 binding that records what was asked of it, and how much of it was in
 * flight at once.
 *
 * Depth is what D1 charges for. A read that issues four statements one after
 * another costs four round trips; the same four issued together cost one, and
 * nothing above the binding can tell the difference — a `Promise.all` that a
 * later edit turns back into sequential `await`s still reads as four calls from
 * anywhere higher up. So the count and the concurrency are taken here, at the
 * binding, which is the only place both are observable.
 *
 * Lives in `src/` rather than beside the suites because two packages' workerd
 * suites use it and a package can only import another across its exports map.
 * Nothing in the deployed Worker imports it.
 */
import { createD1Db, type CruxDb } from "./client.js";

export type CountedDb = {
  /** Hand this to the code under test in place of a real handle. */
  db: CruxDb;
  /** Every statement prepared, in the order it was prepared. */
  statements: string[];
  /** The most statements ever executing at the same moment. 1 means every one
   * of them waited for the one before it. */
  peakConcurrency(): number;
};

/** Wrap a D1 binding so every statement through it is counted. */
export function countingD1(binding: D1Database): CountedDb {
  const statements: string[] = [];
  let inFlight = 0;
  let peak = 0;

  const enter = () => {
    inFlight += 1;
    if (inFlight > peak) peak = inFlight;
  };
  const leave = () => {
    inFlight -= 1;
  };

  /** Execution happens on the prepared statement, so that is what is wrapped —
   * `bind()` returns a fresh one, which has to be wrapped again. */
  const wrapStatement = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        if (prop === "bind") {
          return (...args: unknown[]) =>
            wrapStatement((value as (...a: unknown[]) => D1PreparedStatement).apply(target, args));
        }
        if (prop === "all" || prop === "first" || prop === "run" || prop === "raw") {
          return async (...args: unknown[]) => {
            enter();
            try {
              return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            } finally {
              leave();
            }
          };
        }
        return value.bind(target);
      },
    });

  const proxy = new Proxy(binding, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "prepare") {
        return (sql: string) => {
          statements.push(sql);
          return wrapStatement((value as D1Database["prepare"]).call(target, sql));
        };
      }
      if (prop === "batch") {
        return async (list: D1PreparedStatement[]) => {
          enter();
          try {
            return await (value as D1Database["batch"]).call(target, list);
          } finally {
            leave();
          }
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { db: createD1Db(proxy), statements, peakConcurrency: () => peak };
}
