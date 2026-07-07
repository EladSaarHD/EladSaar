import Foundation
import CryptoKit

/// טביעת אצבע לתנועה למניעת כפילויות בייבוא חוזר של אותו קובץ/תקופה.
enum TxnFingerprint {
    static func make(accountUUID: UUID, date: Date, amount: Decimal, rawMerchant: String, installmentNumber: Int?) -> String {
        let day = Int(date.timeIntervalSince1970 / 86_400)
        let base = "\(accountUUID.uuidString)|\(day)|\(amount)|\(MerchantNormalizer.merchantKey(rawMerchant))|\(installmentNumber ?? 0)"
        let digest = SHA256.hash(data: Data(base.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

struct ImportSummary {
    var imported: Int = 0
    var duplicates: Int = 0
}

/// הפיכת שורות ממופות לתנועות: fingerprint, נרמול שם, הצעת קטגוריה, סימון העברות.
enum ImportService {

    struct PreparedTxn {
        var row: ImportedRow
        var fingerprint: String
        var displayName: String
        var suggestion: CategorySuggestion?
    }

    static func prepare(rows: [ImportedRow],
                        accountUUID: UUID,
                        engine: CategorizationEngine,
                        existingFingerprints: Set<String>) -> (new: [PreparedTxn], duplicates: Int) {
        var new: [PreparedTxn] = []
        var duplicates = 0
        var seenInBatch = Set<String>()

        for row in rows {
            let fp = TxnFingerprint.make(accountUUID: accountUUID,
                                         date: row.date,
                                         amount: row.amount,
                                         rawMerchant: row.rawMerchant,
                                         installmentNumber: row.installmentNumber)
            if existingFingerprints.contains(fp) || seenInBatch.contains(fp) {
                duplicates += 1
                continue
            }
            seenInBatch.insert(fp)

            let facts = TxnFacts(rawMerchant: row.rawMerchant,
                                 displayName: row.rawMerchant,
                                 notes: row.notes,
                                 amount: row.amount,
                                 accountUUID: accountUUID)
            let suggestion = engine.suggest(for: facts)
            let display = suggestion?.displayName
                ?? MerchantNormalizer.lookup(row.rawMerchant)?.displayName
                ?? row.rawMerchant
            new.append(PreparedTxn(row: row, fingerprint: fp, displayName: display, suggestion: suggestion))
        }
        return (new, duplicates)
    }
}
