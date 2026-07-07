import XCTest
@testable import Kaspit

final class RulesEngineTests: XCTestCase {

    private func facts(merchant: String = "וולט", amount: Decimal = -100,
                       notes: String = "", account: UUID? = nil) -> TxnFacts {
        TxnFacts(rawMerchant: merchant, displayName: merchant,
                 notes: notes, amount: amount, accountUUID: account)
    }

    func testMerchantContainsCondition() {
        let rule = RuleSpec(merchantContains: "וולט", setCategoryUUID: UUID())
        XCTAssertTrue(RulesEngine.matches(rule, facts: facts(merchant: "וולט תל אביב")))
        XCTAssertFalse(RulesEngine.matches(rule, facts: facts(merchant: "שופרסל")))
    }

    func testAmountRangeUsesAbsoluteValue() {
        let rule = RuleSpec(amountMin: 50, amountMax: 200)
        XCTAssertTrue(RulesEngine.matches(rule, facts: facts(amount: -100)))
        XCTAssertFalse(RulesEngine.matches(rule, facts: facts(amount: -30)))
        XCTAssertFalse(RulesEngine.matches(rule, facts: facts(amount: -300)))
    }

    func testAllConditionsMustMatch() {
        let account = UUID()
        let rule = RuleSpec(merchantContains: "וולט", amountMin: 50, accountUUID: account)
        XCTAssertTrue(RulesEngine.matches(rule, facts: facts(amount: -80, account: account)))
        XCTAssertFalse(RulesEngine.matches(rule, facts: facts(amount: -80, account: UUID())))
    }

    func testDirectionCondition() {
        let expenseRule = RuleSpec(direction: "expense")
        XCTAssertTrue(RulesEngine.matches(expenseRule, facts: facts(amount: -10)))
        XCTAssertFalse(RulesEngine.matches(expenseRule, facts: facts(amount: 10)))
    }

    func testDisabledRuleNeverMatches() {
        let rule = RuleSpec(isEnabled: false, merchantContains: "וולט")
        XCTAssertFalse(RulesEngine.matches(rule, facts: facts()))
    }

    func testPriorityOrderAndTagAccumulation() {
        let firstCat = UUID()
        let secondCat = UUID()
        let rules = [
            RuleSpec(priority: 2, merchantContains: "וולט", setCategoryUUID: secondCat, addTags: ["משלוחים"]),
            RuleSpec(priority: 1, merchantContains: "וולט", setCategoryUUID: firstCat, addTags: ["אוכל"]),
        ]
        let actions = RulesEngine.apply(rules: rules, to: facts())
        XCTAssertEqual(actions.categoryUUID, firstCat)
        XCTAssertEqual(Set(actions.tags), Set(["אוכל", "משלוחים"]))
    }

    func testHideAndTransferActions() {
        let rules = [RuleSpec(merchantContains: "ביט", hide: false, markTransfer: true, skipReview: true)]
        let actions = RulesEngine.apply(rules: rules, to: facts(merchant: "העברת ביט"))
        XCTAssertTrue(actions.markTransfer)
        XCTAssertTrue(actions.skipReview)
        XCTAssertFalse(actions.hide)
    }
}
