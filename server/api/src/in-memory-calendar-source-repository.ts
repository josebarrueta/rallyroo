import type {
  CalendarSource,
  CalendarSourceRepository,
  ImportedCalendarEvent,
  ImportedEventSettings,
} from "./calendar-source-module.js";

export class InMemoryCalendarSourceRepository implements CalendarSourceRepository {
  private readonly sources: CalendarSource[] = [];
  private readonly events: ImportedCalendarEvent[] = [];
  private readonly eventSettings: ImportedEventSettings[] = [];

  async saveCalendarSource(source: CalendarSource): Promise<void> {
    const index = this.sources.findIndex((candidate) =>
      candidate.familyID === source.familyID && candidate.id === source.id
    );
    if (index >= 0) this.sources[index] = structuredClone(source);
    else this.sources.push(structuredClone(source));
  }

  async calendarSource(familyID: string, sourceID: string): Promise<CalendarSource | null> {
    const source = this.sources.find((candidate) =>
      candidate.familyID === familyID && candidate.id === sourceID
    );
    return source ? structuredClone(source) : null;
  }

  async calendarSourcesForFamily(familyID: string): Promise<CalendarSource[]> {
    return this.sources
      .filter((source) => source.familyID === familyID)
      .map((source) => structuredClone(source));
  }

  async deleteCalendarSource(familyID: string, sourceID: string): Promise<boolean> {
    const index = this.sources.findIndex((source) =>
      source.familyID === familyID && source.id === sourceID
    );
    if (index < 0) return false;
    this.sources.splice(index, 1);
    const remaining = this.events.filter((event) => event.sourceID !== sourceID);
    this.events.splice(0, this.events.length, ...remaining);
    return true;
  }

  async replaceCalendarEvents(
    source: CalendarSource,
    events: ImportedCalendarEvent[],
  ): Promise<void> {
    const remaining = this.events.filter((event) => event.sourceID !== source.id);
    this.events.splice(0, this.events.length, ...remaining, ...structuredClone(events));
    await this.saveCalendarSource(source);
  }

  async calendarEventsForFamily(familyID: string): Promise<ImportedCalendarEvent[]> {
    return this.events
      .filter((event) => event.familyID === familyID)
      .map((event) => {
        const source = this.sources.find((candidate) => candidate.id === event.sourceID);
        return structuredClone({
          ...event,
          sourceOwnerMemberID: source?.ownerMemberID ?? event.sourceOwnerMemberID,
          sourceVisibility: source?.visibility ?? event.sourceVisibility,
        });
      });
  }

  async importedEventSettingsForFamily(familyID: string): Promise<ImportedEventSettings[]> {
    return structuredClone(this.eventSettings.filter((settings) => settings.familyID === familyID));
  }

  async familyIDsWithImportedEventSettings(): Promise<string[]> {
    return [...new Set(this.eventSettings.map((settings) => settings.familyID))];
  }

  async saveImportedEventSettings(settings: ImportedEventSettings): Promise<void> {
    const index = this.eventSettings.findIndex((candidate) =>
      candidate.familyID === settings.familyID && candidate.eventID === settings.eventID
    );
    if (index >= 0) this.eventSettings[index] = structuredClone(settings);
    else this.eventSettings.push(structuredClone(settings));
  }
}
