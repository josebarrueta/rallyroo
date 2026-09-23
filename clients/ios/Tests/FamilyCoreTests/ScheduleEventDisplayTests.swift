import Foundation
import XCTest
@testable import FamilyCore

final class ScheduleEventDisplayTests: XCTestCase {
    func testResolvesTheKidNameAndColorForAnEvent() {
        let kid = FamilyMember(
            id: KidID(rawValue: "emma"),
            name: "Emma",
            role: .kid,
            gradeOrBirthYear: "5th grade",
            colorTag: "purple"
        )
        let event = FamilyEvent(
            title: "Basketball practice",
            kidID: kid.id,
            participantIDs: [kid.id],
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )

        let display = ScheduleEventDisplay(event: event, members: [kid])

        XCTAssertEqual(display.participantNames, ["Emma"])
        XCTAssertEqual(display.primaryColorTag, "purple")
    }

    func testListsEveryParticipantOnAFamilyEvent() {
        let alex = FamilyMember(id: KidID(rawValue: "alex"), name: "Alex", role: .parent, colorTag: "blue")
        let emma = FamilyMember(id: KidID(rawValue: "emma"), name: "Emma", role: .kid, colorTag: "purple")
        let event = FamilyEvent(
            title: "School concert",
            kidID: alex.id,
            participantIDs: [alex.id, emma.id],
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )

        let display = ScheduleEventDisplay(event: event, members: [alex, emma])

        XCTAssertEqual(display.participantNames, ["Alex", "Emma"])
        XCTAssertEqual(display.participantColorTags, ["blue", "purple"])
    }

    func testKeepsKidDetailsEmptyWhenNoKidIsAssigned() {
        let event = FamilyEvent(
            title: "Family dinner",
            kidID: nil,
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )

        let display = ScheduleEventDisplay(event: event, members: [])

        XCTAssertEqual(display.participantNames, [])
        XCTAssertEqual(display.participantColorTags, [])
        XCTAssertNil(display.primaryColorTag)
    }
}
