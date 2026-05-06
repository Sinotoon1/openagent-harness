import type { Note } from "../types.js";

export interface ReadFileWindow {
  limit?: number;
  offset?: number;
}

export interface ReadFileDefaultsResult<T extends ReadFileWindow> {
  input: T;
  notes: Note[];
}

export function applyReadFileRelationalDefaults<T extends ReadFileWindow>(
  input: T
): ReadFileDefaultsResult<T> {
  const next = { ...input };
  const notes: Note[] = [];

  if (next.limit !== undefined && next.offset === undefined) {
    next.offset = 0;
    notes.push({
      code: "readFile.offsetDefaulted",
      path: "offset",
      message: "Applied readFile relational default: limit without offset uses offset = 0."
    });
  }

  if (next.offset !== undefined && next.limit === undefined) {
    next.limit = 2000;
    notes.push({
      code: "readFile.limitDefaulted",
      path: "limit",
      message: "Applied readFile relational default: offset without limit uses limit = 2000."
    });
  }

  return { input: next, notes };
}
