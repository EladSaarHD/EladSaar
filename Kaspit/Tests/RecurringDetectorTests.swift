import XCTest
@testable import Kaspit

final class RecurringDetectorTests: XCTestCase {

    private func txn(_ merchant: String, daysAgo: Int, amount: Decimal, now: Date) -> RecurringCandidateTxn {
        RecurringCandidateTxn(merchantKey: merchant, displayName: merchant,
                              date: Calendar.current.date(byAdding: .day, value: -daysAgo, to: now)!,
                              amount: amount)
    }

    func testDetectsMonthlySubscription() {
        let now = Date()
        let txns = [
            txn("netflix", daysAgo: 90, amount: 55, now: now),
            txn("netflix", daysAgo: 60, amount: 55, now: now),
            txn("netflix", daysAgo: 30, amount: 55, now: now),
        ]
        let detected = RecurringDetector.detect(in: txns, now: now)
        XCTAssertEqual(detected.count, 1)
        XCTAssertEqual(detected.first?.cycle, .monthly)
        XCTAssertEqual(detected.first?.occurrences, 3)
    }

    func testIgnoresIrregularSpending() {
        let now = Date()
        let txns = [
            txn("סופר", daysAgo: 3, amount: 200, now: now),
            txn("סופר", daysAgo: 5, amount: 340, now: now),
            txn("סופר", daysAgo: 40, amount: 150, now: now),
        ]
        XCTAssertTrue(RecurringDetector.detect(in: txns, now: now).isEmpty)
    }

    func testRequiresMinimumOccurrences() {
        let now = Date()
        let txns = [
            txn("spotify", daysAgo: 60, amount: 25, now: now),
            txn("spotify", daysAgo: 30, amount: 25, now: now),
        ]
        XCTAssertTrue(RecurringDetector.detect(in: txns, now: now).isEmpty)
    }

    func testToleratesPriceChange() {
        let now = Date()
        let txns = [
            txn("חדר כושר", daysAgo: 92, amount: 180, now: now),
            txn("חדר כושר", daysAgo: 61, amount: 180, now: now),
            txn("חדר כושר", daysAgo: 31, amount: 199, now: now),
        ]
        let detected = RecurringDetector.detect(in: txns, now: now)
        XCTAssertEqual(detected.count, 1)
        XCTAssertEqual(detected.first?.lastAmount, 199)
    }

    func testDetectsYearlyCycle() {
        let now = Date()
        let txns = [
            txn("ביטוח רכב", daysAgo: 365 * 2 + 3, amount: 3200, now: now),
            txn("ביטוח רכב", daysAgo: 366, amount: 3300, now: now),
            txn("ביטוח רכב", daysAgo: 2, amount: 3400, now: now),
        ]
        let detected = RecurringDetector.detect(in: txns, now: now)
        XCTAssertEqual(detected.first?.cycle, .yearly)
    }
}
