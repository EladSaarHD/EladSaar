import XCTest
@testable import Kaspit

final class CSVImportTests: XCTestCase {

    func testParserHandlesQuotedFieldsAndHebrew() {
        let csv = """
        תאריך,תיאור,סכום
        01/06/2026,"שופרסל, סניף ת\"\"א",-234.50
        02/06/2026,משכורת,12000
        """
        let rows = CSVParser.parse(csv)
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[1][1], "שופרסל, סניף ת\"א")
    }

    func testDetectsIsracardFormat() {
        let header = ["תאריך רכישה", "שם בית עסק", "סכום חיוב", "מספר תשלום"]
        XCTAssertEqual(BankFormat.detect(headerRow: header)?.id, "isracard")
    }

    func testDetectsLeumiFormat() {
        let header = ["תאריך", "תיאור", "אסמכתא", "בחובה", "בזכות", "יתרה"]
        XCTAssertEqual(BankFormat.detect(headerRow: header)?.id, "leumi")
    }

    func testMapsLeumiDebitCreditColumns() {
        let csv = """
        תאריך,תיאור,אסמכתא,בחובה,בזכות
        15/06/2026,וולט,123,86.00,
        16/06/2026,משכורת יוני,456,,12000.00
        """
        let rows = CSVParser.parse(csv)
        let format = BankFormat.all.first { $0.id == "leumi" }!
        let mapped = BankFormatMapper.map(rows: rows, format: format)
        XCTAssertEqual(mapped.count, 2)
        XCTAssertEqual(mapped[0].amount, -86)
        XCTAssertEqual(mapped[1].amount, 12000)
    }

    func testMapsIsracardWithInstallmentsAndFlipsSign() {
        let csv = """
        תאריך רכישה,שם בית עסק,סכום חיוב,תאריך חיוב,מספר תשלום
        10/05/2026,מחשבים בע"מ,500.00,10/06/2026,2 מתוך 6
        """
        let rows = CSVParser.parse(csv)
        let format = BankFormat.all.first { $0.id == "isracard" }!
        let mapped = BankFormatMapper.map(rows: rows, format: format)
        XCTAssertEqual(mapped.count, 1)
        XCTAssertEqual(mapped[0].amount, -500)
        XCTAssertEqual(mapped[0].installmentNumber, 2)
        XCTAssertEqual(mapped[0].installmentCount, 6)
        XCTAssertNotNil(mapped[0].chargeDate)
    }

    func testAmountParsingVariants() {
        XCTAssertEqual(BankFormatMapper.parseAmount("1,234.56"), Decimal(string: "1234.56"))
        XCTAssertEqual(BankFormatMapper.parseAmount("‏₪ 99.90"), Decimal(string: "99.90"))
        XCTAssertEqual(BankFormatMapper.parseAmount("123.45-"), Decimal(string: "-123.45"))
        XCTAssertNil(BankFormatMapper.parseAmount(""))
    }

    func testFingerprintDeduplication() {
        let account = UUID()
        let date = Date()
        let fp1 = TxnFingerprint.make(accountUUID: account, date: date, amount: -50,
                                      rawMerchant: "וולט ת\"א", installmentNumber: nil)
        let fp2 = TxnFingerprint.make(accountUUID: account, date: date, amount: -50,
                                      rawMerchant: "וולט ת\"א 999", installmentNumber: nil)
        // אותו בית עסק מנורמל + אותו יום + אותו סכום = כפילות
        XCTAssertEqual(fp1, fp2)

        let fp3 = TxnFingerprint.make(accountUUID: account, date: date, amount: -51,
                                      rawMerchant: "וולט ת\"א", installmentNumber: nil)
        XCTAssertNotEqual(fp1, fp3)
    }

    func testImportServiceSkipsDuplicates() {
        let account = UUID()
        let row = ImportedRow(date: Date(), chargeDate: nil, amount: -100, rawMerchant: "שופרסל")
        let engine = CategorizationEngine()
        let first = ImportService.prepare(rows: [row, row], accountUUID: account,
                                          engine: engine, existingFingerprints: [])
        XCTAssertEqual(first.new.count, 1)
        XCTAssertEqual(first.duplicates, 1)

        let second = ImportService.prepare(rows: [row], accountUUID: account,
                                           engine: engine,
                                           existingFingerprints: [first.new[0].fingerprint])
        XCTAssertEqual(second.new.count, 0)
        XCTAssertEqual(second.duplicates, 1)
    }

    func testMonthKeyMath() {
        XCTAssertEqual(MonthKey.previous("2026-01"), "2025-12")
        XCTAssertEqual(MonthKey.next("2026-12"), "2027-01")
        let date = MonthKey.date(from: "2026-07")
        XCTAssertNotNil(date)
        XCTAssertEqual(MonthKey.key(for: date!), "2026-07")
    }
}
