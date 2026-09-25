import type { CalendarSourceModule } from "./calendar-source-module.js";
import type {
  DayBriefPersistence,
  DayBriefPreferenceCursor,
  DayBriefPreferences,
  DayBriefRecord,
  DayBriefRepository,
} from "./day-brief.js";
import type { RallyrooRepository } from "./repository.js";

export class RallyrooDayBriefRepository implements DayBriefRepository, DayBriefPersistence {
  constructor(
    private readonly schedule: RallyrooRepository,
    private readonly persistence: DayBriefPersistence,
    private readonly calendarSources?: Pick<CalendarSourceModule, "events">,
  ) {}

  eventsForFamily(familyID: string) {
    return this.schedule.eventsForFamily(familyID);
  }

  importedEventsForMember(familyID: string, memberID: string) {
    return this.calendarSources?.events(familyID, memberID) ?? Promise.resolve([]);
  }

  remindersForFamily(familyID: string) {
    return this.schedule.remindersForFamily(familyID);
  }

  occurrenceStatesForFamily(familyID: string) {
    return this.schedule.occurrenceStatesForFamily(familyID);
  }

  preferences(familyID: string, memberID: string) {
    return this.persistence.preferences(familyID, memberID);
  }

  savePreferences(preferences: DayBriefPreferences) {
    return this.persistence.savePreferences(preferences);
  }

  enabledPreferences(limit: number, after?: DayBriefPreferenceCursor) {
    return this.persistence.enabledPreferences(limit, after);
  }

  saveDayBriefIfAbsent(record: DayBriefRecord) {
    return this.persistence.saveDayBriefIfAbsent(record);
  }

  dayBrief(familyID: string, memberID: string, localDate: string) {
    return this.persistence.dayBrief(familyID, memberID, localDate);
  }
}
