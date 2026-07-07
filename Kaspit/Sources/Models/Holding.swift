import Foundation
import SwiftData

/// אחזקה בתיק השקעות: מניה, קרן סל, קרן נאמנות, קריפטו.
@Model
final class Holding {
    var uuid: UUID = UUID()
    /// סימול: AAPL, ‎TA35.TA‎, מספר נייר בבורסת ת"א.
    var symbol: String = ""
    var name: String = ""
    var quantity: Decimal = 0
    /// עלות כוללת (בסיס עלות).
    var costBasis: Decimal = 0
    var lastPrice: Decimal = 0
    var lastPriceDate: Date?
    var currencyCode: String = "ILS"

    var account: Account?

    var marketValue: Decimal { quantity * lastPrice }
    var gain: Decimal { marketValue - costBasis }
    var gainPercent: Double {
        guard costBasis != 0 else { return 0 }
        return ((gain as NSDecimalNumber).doubleValue / (costBasis as NSDecimalNumber).doubleValue) * 100
    }

    init(symbol: String, name: String, quantity: Decimal, costBasis: Decimal, lastPrice: Decimal, currencyCode: String = "ILS", account: Account? = nil) {
        self.symbol = symbol
        self.name = name
        self.quantity = quantity
        self.costBasis = costBasis
        self.lastPrice = lastPrice
        self.currencyCode = currencyCode
        self.account = account
    }
}
