import Foundation

/// שורה מיובאת אחרי מיפוי, לפני הפיכה לתנועה.
struct ImportedRow: Equatable {
    var date: Date
    var chargeDate: Date?
    /// סכום חתום: הוצאה שלילית.
    var amount: Decimal
    var rawMerchant: String
    var notes: String = ""
    var installmentNumber: Int?
    var installmentCount: Int?
    var currencyCode: String = "ILS"
}

/// הגדרת פורמט ייצוא של מוסד פיננסי ישראלי.
/// הפורמטים בפועל משתנים מעת לעת — האשף מאפשר גם מיפוי עמודות ידני,
/// וההגדרות כאן משמשות כברירת מחדל וזיהוי אוטומטי לפי שורת הכותרת.
struct BankFormat: Identifiable {
    var id: String
    var name: String
    /// מילים ששורת הכותרת חייבת להכיל לזיהוי אוטומטי.
    var headerSignature: [String]
    var dateColumn: String
    var chargeDateColumn: String?
    var merchantColumn: String
    /// עמודת סכום יחידה (חתום) — או זוג חובה/זכות.
    var amountColumn: String?
    var debitColumn: String?
    var creditColumn: String?
    var notesColumn: String?
    var installmentsColumn: String?
    var dateFormats: [String] = ["dd/MM/yyyy", "dd/MM/yy", "dd-MM-yyyy", "yyyy-MM-dd"]
    /// בקבצי חברות אשראי הסכומים חיוביים ומשמעם חיוב — יש להפוך סימן.
    var amountsArePositiveCharges: Bool = false

    static let all: [BankFormat] = [
        BankFormat(id: "leumi", name: "בנק לאומי",
                   headerSignature: ["תאריך", "תיאור", "בחובה", "בזכות"],
                   dateColumn: "תאריך", chargeDateColumn: nil,
                   merchantColumn: "תיאור",
                   amountColumn: nil, debitColumn: "בחובה", creditColumn: "בזכות",
                   notesColumn: "אסמכתא"),
        BankFormat(id: "hapoalim", name: "בנק הפועלים",
                   headerSignature: ["תאריך", "פעולה", "חובה", "זכות"],
                   dateColumn: "תאריך", chargeDateColumn: nil,
                   merchantColumn: "פעולה",
                   amountColumn: nil, debitColumn: "חובה", creditColumn: "זכות",
                   notesColumn: "פרטים"),
        BankFormat(id: "discount", name: "בנק דיסקונט",
                   headerSignature: ["תאריך", "תיאור התנועה", "סכום"],
                   dateColumn: "תאריך", chargeDateColumn: nil,
                   merchantColumn: "תיאור התנועה",
                   amountColumn: "סכום", debitColumn: nil, creditColumn: nil,
                   notesColumn: nil),
        BankFormat(id: "mizrahi", name: "מזרחי-טפחות",
                   headerSignature: ["תאריך", "תיאור", "חיוב", "זיכוי"],
                   dateColumn: "תאריך", chargeDateColumn: nil,
                   merchantColumn: "תיאור",
                   amountColumn: nil, debitColumn: "חיוב", creditColumn: "זיכוי",
                   notesColumn: nil),
        BankFormat(id: "onezero", name: "One Zero",
                   headerSignature: ["date", "description", "amount"],
                   dateColumn: "date", chargeDateColumn: nil,
                   merchantColumn: "description",
                   amountColumn: "amount", debitColumn: nil, creditColumn: nil,
                   notesColumn: nil),
        BankFormat(id: "isracard", name: "ישראכרט",
                   headerSignature: ["תאריך רכישה", "שם בית עסק", "סכום חיוב"],
                   dateColumn: "תאריך רכישה", chargeDateColumn: "תאריך חיוב",
                   merchantColumn: "שם בית עסק",
                   amountColumn: "סכום חיוב", debitColumn: nil, creditColumn: nil,
                   notesColumn: "הערות", installmentsColumn: "מספר תשלום",
                   amountsArePositiveCharges: true),
        BankFormat(id: "max", name: "מקס (לאומי קארד)",
                   headerSignature: ["תאריך עסקה", "שם בית העסק", "סכום חיוב"],
                   dateColumn: "תאריך עסקה", chargeDateColumn: "מועד חיוב",
                   merchantColumn: "שם בית העסק",
                   amountColumn: "סכום חיוב", debitColumn: nil, creditColumn: nil,
                   notesColumn: "הערות", installmentsColumn: "תשלומים",
                   amountsArePositiveCharges: true),
        BankFormat(id: "cal", name: "כאל (Cal)",
                   headerSignature: ["תאריך העסקה", "שם בית העסק", "סכום החיוב"],
                   dateColumn: "תאריך העסקה", chargeDateColumn: "תאריך החיוב",
                   merchantColumn: "שם בית העסק",
                   amountColumn: "סכום החיוב", debitColumn: nil, creditColumn: nil,
                   notesColumn: "הערות", installmentsColumn: "מספר תשלומים",
                   amountsArePositiveCharges: true),
    ]

    /// זיהוי פורמט אוטומטי לפי שורת הכותרת.
    static func detect(headerRow: [String]) -> BankFormat? {
        let normalized = headerRow.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        return all.first { format in
            format.headerSignature.allSatisfy { sig in
                normalized.contains { $0.contains(sig.lowercased()) }
            }
        }
    }
}

enum BankFormatMapper {

    /// מיפוי שורות CSV (כולל שורת כותרת) לרשומות ייבוא לפי פורמט.
    static func map(rows: [[String]], format: BankFormat) -> [ImportedRow] {
        guard let headerIndex = rows.firstIndex(where: { row in
            format.headerSignature.allSatisfy { sig in
                row.contains { $0.lowercased().contains(sig.lowercased()) }
            }
        }) else { return [] }

        let header = rows[headerIndex].map { $0.trimmingCharacters(in: .whitespaces) }
        func col(_ name: String?) -> Int? {
            guard let name else { return nil }
            return header.firstIndex { $0.lowercased().contains(name.lowercased()) }
        }

        let dateIdx = col(format.dateColumn)
        let chargeIdx = col(format.chargeDateColumn)
        let merchantIdx = col(format.merchantColumn)
        let amountIdx = col(format.amountColumn)
        let debitIdx = col(format.debitColumn)
        let creditIdx = col(format.creditColumn)
        let notesIdx = col(format.notesColumn)
        let instIdx = col(format.installmentsColumn)

        guard let dIdx = dateIdx, let mIdx = merchantIdx else { return [] }

        var result: [ImportedRow] = []
        for row in rows[(headerIndex + 1)...] {
            guard row.count > max(dIdx, mIdx),
                  let date = parseDate(row[dIdx], formats: format.dateFormats) else { continue }
            let merchant = row[mIdx]
            guard !merchant.isEmpty else { continue }

            var amount: Decimal?
            if let aIdx = amountIdx, row.count > aIdx {
                amount = parseAmount(row[aIdx])
                if format.amountsArePositiveCharges, let a = amount, a > 0 { amount = -a }
            } else if let dbIdx = debitIdx, let crIdx = creditIdx {
                let debit = row.count > dbIdx ? parseAmount(row[dbIdx]) : nil
                let credit = row.count > crIdx ? parseAmount(row[crIdx]) : nil
                if let d = debit, d != 0 { amount = -abs(d) }
                else if let c = credit, c != 0 { amount = abs(c) }
            }
            guard let finalAmount = amount, finalAmount != 0 else { continue }

            var imported = ImportedRow(date: date, chargeDate: nil, amount: finalAmount, rawMerchant: merchant)
            if let cIdx = chargeIdx, row.count > cIdx {
                imported.chargeDate = parseDate(row[cIdx], formats: format.dateFormats)
            }
            if let nIdx = notesIdx, row.count > nIdx { imported.notes = row[nIdx] }
            if let iIdx = instIdx, row.count > iIdx {
                let (n, c) = parseInstallments(row[iIdx])
                imported.installmentNumber = n
                imported.installmentCount = c
            }
            result.append(imported)
        }
        return result
    }

    static func parseDate(_ s: String, formats: [String]) -> Date? {
        let trimmed = s.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Jerusalem")
        for format in formats {
            f.dateFormat = format
            if let d = f.date(from: trimmed) { return d }
        }
        return nil
    }

    /// "‏1,234.56 ₪" → 1234.56
    static func parseAmount(_ s: String) -> Decimal? {
        var cleaned = s.replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "₪", with: "")
            .replacingOccurrences(of: "\u{200f}", with: "")
            .replacingOccurrences(of: "\u{200e}", with: "")
            .trimmingCharacters(in: .whitespaces)
        guard !cleaned.isEmpty else { return nil }
        // סימן מינוס בסוף ("123.45-") מופיע בחלק מהייצואים
        if cleaned.hasSuffix("-") { cleaned = "-" + cleaned.dropLast() }
        return Decimal(string: cleaned, locale: Locale(identifier: "en_US_POSIX"))
    }

    /// "3 מתוך 12" / "3/12" → (3, 12)
    static func parseInstallments(_ s: String) -> (Int?, Int?) {
        let numbers = s.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
        if numbers.count >= 2 { return (numbers[0], numbers[1]) }
        return (nil, nil)
    }
}
