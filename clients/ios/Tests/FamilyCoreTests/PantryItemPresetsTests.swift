import XCTest
@testable import FamilyCore

final class PantryItemPresetsTests: XCTestCase {
    func testEachCategoryHasDistinctGenericSuggestions() {
        XCTAssertEqual(PantryItemPresets.categories,
            ["Food", "Cleaning supplies", "Personal care", "Household supplies", "Other"])
        let all = PantryItemPresets.categories.flatMap(PantryItemPresets.names(for:))
        XCTAssertEqual(all.count, Set(all.map { $0.lowercased() }).count)
        XCTAssertTrue(PantryItemPresets.categories.allSatisfy { !PantryItemPresets.names(for: $0).isEmpty })
        XCTAssertEqual(PantryItemPresets.names(for: "Dairy alternatives"), [])
    }
}
