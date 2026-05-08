import { afterEach, vi } from "vitest";
import { cleanupTempDirs } from "./tempFiles.js";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTempDirs();
});
