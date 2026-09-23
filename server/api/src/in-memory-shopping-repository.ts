import {
  normalizedShoppingName,
  ShoppingNameConflictError,
  ShoppingRoutineReferenceError,
  type PantryItem,
  type ShoppingCatalog,
  type ShoppingRepository,
  type ShoppingRoutine,
} from "./shopping-module.js";

export class InMemoryShoppingRepository implements ShoppingRepository {
  private readonly routines: ShoppingRoutine[] = [];
  private readonly items: PantryItem[] = [];

  async catalog(familyID: string): Promise<ShoppingCatalog> {
    return {
      routines: this.routines.filter((routine) => routine.familyID === familyID)
        .map((routine) => ({ ...routine })),
      items: this.items.filter((item) => item.familyID === familyID)
        .map((item) => ({ ...item, routineIDs: [...item.routineIDs] })),
    };
  }

  async saveRoutine(routine: ShoppingRoutine): Promise<ShoppingRoutine> {
    if (this.routines.some((candidate) => candidate.familyID === routine.familyID
      && candidate.id !== routine.id
      && normalizedShoppingName(candidate.storeName)
        === normalizedShoppingName(routine.storeName))) {
      throw new ShoppingNameConflictError("routine");
    }
    const index = this.routines.findIndex((candidate) => candidate.familyID === routine.familyID
      && candidate.id === routine.id);
    if (index >= 0) this.routines[index] = { ...routine };
    else this.routines.push({ ...routine });
    return { ...routine };
  }

  async deleteRoutine(familyID: string, routineID: string): Promise<boolean> {
    const index = this.routines.findIndex((routine) => routine.familyID === familyID
      && routine.id === routineID);
    if (index < 0) return false;
    this.routines.splice(index, 1);
    for (let itemIndex = 0; itemIndex < this.items.length; itemIndex += 1) {
      const item = this.items[itemIndex]!;
      if (item.familyID === familyID && item.routineIDs.includes(routineID)) {
        this.items[itemIndex] = {
          ...item,
          routineIDs: item.routineIDs.filter((id) => id !== routineID),
        };
      }
    }
    return true;
  }

  async savePantryItem(item: PantryItem): Promise<PantryItem> {
    if (item.routineIDs.some((routineID) => !this.routines.some((routine) =>
      routine.familyID === item.familyID && routine.id === routineID))) {
      throw new ShoppingRoutineReferenceError();
    }
    if (this.items.some((candidate) => candidate.familyID === item.familyID
      && candidate.id !== item.id
      && normalizedShoppingName(candidate.name) === normalizedShoppingName(item.name))) {
      throw new ShoppingNameConflictError("pantry_item");
    }
    const copy = { ...item, routineIDs: [...item.routineIDs] };
    const index = this.items.findIndex((candidate) => candidate.familyID === item.familyID
      && candidate.id === item.id);
    if (index >= 0) this.items[index] = copy;
    else this.items.push(copy);
    return { ...copy, routineIDs: [...copy.routineIDs] };
  }

  async deletePantryItem(familyID: string, itemID: string): Promise<boolean> {
    const index = this.items.findIndex((item) => item.familyID === familyID && item.id === itemID);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }
}
