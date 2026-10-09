import type { Guest, RsvpStatus } from "../types/invitation";

export function calculateRsvpStatus(guests: readonly Guest[]): RsvpStatus {
  if (guests.length > 0 && guests.every((guest) => guest.attending === null)) {
    return "pending";
  }

  const attending = guests.filter((guest) => guest.attending === true).length;
  if (attending === 0) return "declined";
  return guests.some((guest) => guest.type === "known" && guest.attending === false)
    ? "partial"
    : "confirmed";
}
