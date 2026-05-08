#!/usr/bin/env node
import { readFileSync } from "node:fs";

const inputPath = process.argv[2];

function readInput() {
  if (inputPath) {
    return readFileSync(inputPath, "utf8");
  }

  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const input = readInput();
if (!input) {
  console.error("Usage: node scripts/estimate-json-tokens.mjs [json-file]");
  console.error("Or pipe JSON on stdin.");
  process.exit(1);
}

try {
  JSON.parse(input);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Invalid JSON: ${message}`);
  process.exit(1);
}

const charCount = input.length;
const estimatedTokens = Math.ceil(charCount / 4);

console.log(`char count: ${charCount}`);
console.log(`estimated tokens: ${estimatedTokens}`);
console.log("estimated tokens by charCount / 4");
