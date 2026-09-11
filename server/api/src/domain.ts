export type AccountRole = "parent" | "kid";

export interface Identity {
  subject: string;
  displayName: string;
  email?: string;
}

export interface FamilyInvitation {
  id: string;
  codeHash: string;
  familyID: string;
  recipientEmail: string | null;
  role: AccountRole;
  expiresAt: string;
  guardianConsentAt?: string | null;
  guardianMemberID?: string | null;
}

export interface Account {
  identitySubject: string;
  familyID: string;
  memberID: string;
  role: AccountRole;
}

export interface FamilyMember {
  id: string;
  familyID: string;
  name: string;
  role: AccountRole;
  gradeOrBirthYear?: string | null;
  colorTag: string;
  canDrive?: boolean;
}

export interface EventRecurrence {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  weekdays?: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> | undefined;
  endDate: string;
}

export interface FamilyEvent {
  id: string;
  familyID: string;
  title: string;
  kidID: string | null;
  participantIDs: string[];
  startTime: string;
  endTime: string;
  location: string | null;
  driver: string | null;
  driverMemberID?: string | null;
  source: "manual" | "email_suggested" | "voice" | "calendar";
  status: "confirmed" | "pending_review";
  alertLeadTimeMinutes?: 0 | 5 | 15 | 30 | 45 | 60 | 1440 | null;
  recurrence?: EventRecurrence | null;
  recurrenceSeriesID?: string | null;
  readOnly?: boolean;
  provenance?: Array<{
    sourceID: string;
    sourceName: string;
    externalUID: string;
  }>;
}

export interface FamilyReminder {
  id: string;
  familyID: string;
  title: string;
  assigneeIDs: string[];
  dueAt: string;
  status: "open" | "completed";
  completedAt: string | null;
  completedByMemberID: string | null;
  alertLeadTimeMinutes: 0 | 5 | 15 | 60 | 1440 | null;
  createdByMemberID: string;
}

export interface EventConflict {
  kind: "overlapping_participant" | "double_booked_driver";
  memberID: string | null;
  driver: string | null;
  eventIDs: string[];
}
