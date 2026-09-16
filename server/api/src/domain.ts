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
  /** IANA time-zone identifier used to preserve the series' local wall-clock time. */
  timeZone?: string | undefined;
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
  arrivalTime?: string | null;
  location: string | null;
  driver: string | null;
  driverMemberID?: string | null;
  source: "manual" | "email_suggested" | "voice" | "calendar";
  status: "confirmed" | "pending_review";
  alertLeadTimeMinutes?: 0 | 5 | 15 | 30 | 45 | 60 | 1440 | null;
  recurrence?: EventRecurrence | null;
  recurrenceSeriesID?: string | null;
  occurrenceStates?: ScheduleOccurrenceState[];
  readOnly?: boolean;
  provenance?: Array<{
    sourceID: string;
    sourceName: string;
    externalUID: string;
  }>;
}

export type ScheduleOccurrenceKind = "event" | "reminder";
export type ScheduleOccurrenceDisposition = "scheduled" | "skipped" | "deleted";

export interface ScheduleOccurrenceReference {
  kind: ScheduleOccurrenceKind;
  seriesID: string;
  /** The occurrence's original scheduled instant; overrides never change this identity. */
  scheduledAt: string;
}

export interface ScheduleOccurrenceState {
  familyID: string;
  reference: ScheduleOccurrenceReference;
  disposition: ScheduleOccurrenceDisposition;
  acknowledgedMemberIDs: string[];
  overrideEntityID: string | null;
  completedAt: string | null;
  completedByMemberID: string | null;
}

export type ReminderFrequency = "weekly" | "biweekly";
export type ReminderWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

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
  // Recurrence: null on one-time; set on series templates.
  recurrenceFrequency?: ReminderFrequency | null;
  recurrenceInterval?: number | null;
  recurrenceWeekdays?: number[] | null;
  recurrenceEndDate?: string | null;
  recurrenceSeriesID?: string | null;
}

export interface EventConflict {
  kind: "overlapping_participant" | "double_booked_driver";
  memberID: string | null;
  driver: string | null;
  eventIDs: string[];
}
