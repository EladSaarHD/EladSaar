import Foundation
import SwiftData

/// צילום שווי נקי, נשמר אוטומטית אחת לחודש ובכל שינוי משמעותי.
@Model
final class NetWorthSnapshot {
    var uuid: UUID = UUID()
    var date: Date = Date()
    var totalAssets: Decimal = 0
    var totalLiabilities: Decimal = 0

    var netWorth: Decimal { totalAssets - totalLiabilities }

    init(date: Date, totalAssets: Decimal, totalLiabilities: Decimal) {
        self.date = date
        self.totalAssets = totalAssets
        self.totalLiabilities = totalLiabilities
    }
}
