import { createHash } from "node:crypto";

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])])
    );
  }
  return value;
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function commitment(value) {
  return sha256(canonicalJson(value));
}
