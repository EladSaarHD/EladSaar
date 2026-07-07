import XCTest
@testable import Kaspit

final class CategorizationEngineTests: XCTestCase {

    func testMerchantKeyNormalization() {
        XCTAssertEqual(MerchantNormalizer.merchantKey("שופרסל דיל בע\"מ 4432"),
                       MerchantNormalizer.merchantKey("שופרסל דיל"))
        XCTAssertFalse(MerchantNormalizer.merchantKey("PAYPAL *SPOTIFY").contains("paypal"))
    }

    func testBuiltinDictionaryMatchesIsraeliMerchants() {
        let wolt = MerchantNormalizer.lookup("WOLT TLV 123")
        XCTAssertEqual(wolt?.categoryName, "אוכל בחוץ")

        let shufersal = MerchantNormalizer.lookup("שופרסל של בע\"מ ת\"א")
        XCTAssertEqual(shufersal?.displayName, "שופרסל")
        XCTAssertEqual(shufersal?.categoryName, "סופר")

        let bit = MerchantNormalizer.lookup("העברת ביט - דנה")
        XCTAssertEqual(bit?.isP2P, true)
    }

    func testLearnedLayerBeatsBuiltin() {
        let catUUID = UUID()
        var engine = CategorizationEngine()
        engine.learned = ["וולט": catUUID]

        let facts = TxnFacts(rawMerchant: "וולט 555", displayName: "וולט 555",
                             notes: "", amount: -80, accountUUID: nil)
        let suggestion = engine.suggest(for: facts)
        XCTAssertEqual(suggestion?.categoryUUID, catUUID)
        if case .learned = suggestion!.source {} else { XCTFail("expected learned source") }
    }

    func testRuleLayerBeatsEverything() {
        let ruleCat = UUID()
        let learnedCat = UUID()
        var engine = CategorizationEngine()
        engine.learned = ["וולט": learnedCat]
        engine.rules = [RuleSpec(merchantContains: "וולט", setCategoryUUID: ruleCat)]

        let facts = TxnFacts(rawMerchant: "וולט", displayName: "וולט",
                             notes: "", amount: -80, accountUUID: nil)
        let suggestion = engine.suggest(for: facts)
        XCTAssertEqual(suggestion?.categoryUUID, ruleCat)
    }

    func testBuildLearnedKeepsLatestCorrection() {
        let older = UUID()
        let newer = UUID()
        let learned = CategorizationEngine.buildLearned(from: [
            ("וולט", older, Date(timeIntervalSince1970: 100)),
            ("וולט", newer, Date(timeIntervalSince1970: 200)),
        ])
        XCTAssertEqual(learned["וולט"], newer)
    }

    func testUnknownMerchantReturnsNil() {
        let engine = CategorizationEngine()
        let facts = TxnFacts(rawMerchant: "מסעדה אקראית כלשהי", displayName: "",
                             notes: "", amount: -50, accountUUID: nil)
        XCTAssertNil(engine.suggest(for: facts))
    }
}
