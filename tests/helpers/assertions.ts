import { expect } from "vitest";

export function expectTextNotToContainAny(text: string, rawValues: string[]): void {
  for (const rawValue of rawValues) {
    expect(text).not.toContain(rawValue);
  }
}
