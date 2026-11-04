import type { SupabaseClient } from "@supabase/supabase-js";

export interface DbCall {
  /** Table name for `.from()` chains, or `rpc:<fn>` for rpc calls. */
  target: string;
  ops: Array<[string, unknown[]]>;
}

type Result = { data: unknown; error: unknown };

/**
 * Chainable stand-in for the Supabase query builder. Records every call so
 * tests can assert what a service sent to the database, and resolves each
 * query with whatever `handler` returns. Unit-test only: it does not model SQL.
 */
export function fakeDb(handler: (call: DbCall) => Result) {
  const calls: DbCall[] = [];

  const chain = (target: string) => {
    const call: DbCall = { target, ops: [] };
    const settle = () => {
      calls.push(call);
      return Promise.resolve(handler(call));
    };
    const builder: Record<string, unknown> = {};
    for (const op of ["select", "insert", "update", "delete", "eq", "neq", "gt", "gte", "lt", "lte", "ilike", "order", "range", "limit"]) {
      builder[op] = (...args: unknown[]) => {
        call.ops.push([op, args]);
        return builder;
      };
    }
    builder.single = () => {
      call.ops.push(["single", []]);
      return settle();
    };
    builder.maybeSingle = () => {
      call.ops.push(["maybeSingle", []]);
      return settle();
    };
    builder.then = (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => settle().then(resolve, reject);
    return builder;
  };

  const db = {
    from: (table: string) => chain(table),
    rpc: (fn: string, args?: unknown) => {
      const call: DbCall = { target: `rpc:${fn}`, ops: [["rpc", [args]]] };
      calls.push(call);
      return Promise.resolve(handler(call));
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

/** Find the arguments of the first recorded op with this name on a call. */
export function opArgs(call: DbCall | undefined, op: string): unknown[] | undefined {
  return call?.ops.find(([name]) => name === op)?.[1];
}
