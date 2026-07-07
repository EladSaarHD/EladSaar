import XCTest
@testable import Kaspit

final class TransferMatcherTests: XCTestCase {

    func testMatchesOppositeAmountsAcrossAccounts() {
        let checking = UUID()
        let savings = UUID()
        let now = Date()
        let out = TransferCandidate(id: UUID(), accountUUID: checking, accountKind: .checking,
                                    amount: -1000, date: now, merchantKey: "העברה")
        let inc = TransferCandidate(id: UUID(), accountUUID: savings, accountKind: .savings,
                                    amount: 1000, date: now.addingTimeInterval(86_400), merchantKey: "העברה")
        let pairs = TransferMatcher.findPairs(in: [out, inc])
        XCTAssertEqual(pairs, [TransferPair(outgoingID: out.id, incomingID: inc.id)])
    }

    func testDoesNotMatchSameAccount() {
        let account = UUID()
        let now = Date()
        let out = TransferCandidate(id: UUID(), accountUUID: account, accountKind: .checking,
                                    amount: -500, date: now, merchantKey: "x")
        let inc = TransferCandidate(id: UUID(), accountUUID: account, accountKind: .checking,
                                    amount: 500, date: now, merchantKey: "y")
        XCTAssertTrue(TransferMatcher.findPairs(in: [out, inc]).isEmpty)
    }

    func testDoesNotMatchOutsideDateWindow() {
        let now = Date()
        let out = TransferCandidate(id: UUID(), accountUUID: UUID(), accountKind: .checking,
                                    amount: -500, date: now, merchantKey: "x")
        let inc = TransferCandidate(id: UUID(), accountUUID: UUID(), accountKind: .savings,
                                    amount: 500, date: now.addingTimeInterval(10 * 86_400), merchantKey: "y")
        XCTAssertTrue(TransferMatcher.findPairs(in: [out, inc]).isEmpty)
    }

    func testDetectsIsraeliCardSettlement() {
        let settlement = TransferCandidate(id: UUID(), accountUUID: UUID(), accountKind: .checking,
                                           amount: -8500, date: Date(),
                                           merchantKey: MerchantNormalizer.merchantKey("ישראכרט בע\"מ"))
        XCTAssertTrue(TransferMatcher.isCardSettlement(settlement))

        let regular = TransferCandidate(id: UUID(), accountUUID: UUID(), accountKind: .checking,
                                        amount: -8500, date: Date(),
                                        merchantKey: MerchantNormalizer.merchantKey("שכר דירה"))
        XCTAssertFalse(TransferMatcher.isCardSettlement(regular))
    }
}
