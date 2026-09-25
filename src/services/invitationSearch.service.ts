import type { Guest } from "../types/invitation";

export const MAX_SEARCH_PREFIX_LENGTH = 64;
export const MAX_SEARCH_PREFIXES = 5_000;

export function normalizeInvitationSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function addPrefixes(target: Set<string>, value: string): void {
  const upperBound = Math.min(value.length, MAX_SEARCH_PREFIX_LENGTH);
  for (let length = 1; length <= upperBound; length += 1) {
    if (target.size >= MAX_SEARCH_PREFIXES) return;
    target.add(value.slice(0, length));
  }
}

export function buildInvitationSearchPrefixes(
  id: string,
  displayName: string,
  guests: readonly Pick<Guest, "name">[],
): string[] {
  const prefixes = new Set<string>();
  const sources = [id, displayName, ...guests.map(({ name }) => name)];

  for (const source of sources) {
    const normalized = normalizeInvitationSearch(source);
    if (!normalized) continue;
    addPrefixes(prefixes, normalized);
    for (const word of normalized.split(" ")) addPrefixes(prefixes, word);
    if (prefixes.size >= MAX_SEARCH_PREFIXES) break;
  }

  return [...prefixes].sort();
}
