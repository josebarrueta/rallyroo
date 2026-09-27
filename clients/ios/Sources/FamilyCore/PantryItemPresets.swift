/// Optional shortcuts for parent-managed Pantry catalog entries. Presets are
/// examples, not Family Stock observations, requests, or shopping decisions.
public enum PantryItemPresets {
    public static let categories = ["Food", "Cleaning supplies", "Personal care", "Household supplies", "Other"]

    public static func names(for category: String) -> [String] {
        switch category {
        case "Food":
            return ["Milk", "Eggs", "Bread", "Apples", "Rice", "Pasta", "Chicken", "Bananas", "Cheese", "Tomatoes"]
        case "Cleaning supplies":
            return ["Dish soap", "All-purpose cleaner", "Glass cleaner", "Trash bags", "Sponges", "Laundry detergent"]
        case "Personal care":
            return ["Toothpaste", "Shampoo", "Soap", "Deodorant", "Razors"]
        case "Household supplies":
            return ["Paper towels", "Toilet paper", "Light bulbs", "Batteries"]
        case "Other":
            return ["Pet food", "Gift wrap", "Stamps", "Notebooks"]
        default:
            return []
        }
    }
}
