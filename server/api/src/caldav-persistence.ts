import type { Account, FamilyEvent } from "./domain.js";

export interface CalendarConnection {
  id: string;
  identitySubject: string;
  familyID: string;
  memberID: string;
  passwordHash: string;
  createdAt: string;
  timeZone?: string;
}

/** The URL's resource name and iCalendar UID are independent opaque identities. */
export interface CalendarResource {
  eventID: string;
  name: string;
  uid: string;
  data: string;
}

export interface CalendarPersistence {
  createCalendarConnection(connection: CalendarConnection): Promise<boolean>;
  calendarConnection(id: string): Promise<CalendarConnection | null>;
  calendarConnections(account: Account): Promise<CalendarConnection[]>;
  revokeCalendarConnection(account: Account, id: string): Promise<boolean>;
  calendarResources(familyID: string): Promise<CalendarResource[]>;
  calendarSnapshot(familyID: string): Promise<{ events: FamilyEvent[]; resources: CalendarResource[] }>;
}

export interface CalendarCondition {
  ifMatch?: string | undefined;
  ifNoneMatch?: string | undefined;
}

export interface CalendarWrite extends CalendarCondition {
  timeZone?: string;
  name: string;
  data: string;
  uid: string;
}

export class CalendarError extends Error {
  constructor(readonly statusCode: number, readonly condition: string) {
    super(condition);
    this.name = "CalendarError";
  }
}
