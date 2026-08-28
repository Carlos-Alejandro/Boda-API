export type GuestType = "known" | "open" | "replacement";

export interface Guest {
  name: string;
  shortName: string;
  type: GuestType;
  attending: boolean | null;
  originalName?: string;
}

export type RsvpStatus = "pending" | "confirmed" | "partial" | "declined";

export interface Invitation {
  id: string;
  displayName: string;
  maxGuests: number;
  replacementsAllowed: boolean;
  rsvpStatus: RsvpStatus;
  message: string;
  updatedAt: Date | null;
  editOverrideUntil: Date | null;
  guests: Guest[];
}

export type InvitationData = Omit<Invitation, "id">;

export interface CreateInvitationInput {
  displayName: string;
  knownGuests: Array<{ name: string }>;
  openSlots: number;
  replacementsAllowed: boolean;
}
