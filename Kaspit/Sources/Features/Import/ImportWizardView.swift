import SwiftUI
import SwiftData
import UniformTypeIdentifiers

/// אשף ייבוא קובץ בנק/כרטיס אשראי: בחירת חשבון → קובץ → זיהוי פורמט → תצוגה מקדימה → ייבוא.
struct ImportWizardView: View {
    @Query private var accounts: [Account]
    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Query private var rules: [Rule]
    @Query private var txns: [Txn]
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var accountUUID: UUID?
    @State private var formatID: String?
    @State private var showFilePicker = false
    @State private var fileText: String?
    @State private var fileName = ""
    @State private var prepared: [ImportService.PreparedTxn] = []
    @State private var duplicates = 0
    @State private var errorMessage: String?
    @State private var imported = false

    private var selectedAccount: Account? { accounts.first { $0.uuid == accountUUID } }

    var body: some View {
        NavigationStack {
            Form {
                if imported {
                    doneSection
                } else {
                    Section("1. לאיזה חשבון לייבא?") {
                        Picker("חשבון", selection: $accountUUID) {
                            Text("בחר...").tag(UUID?.none)
                            ForEach(accounts.filter { !$0.isArchived }, id: \.uuid) { acc in
                                Text("\(acc.kind.emoji) \(acc.name)").tag(UUID?.some(acc.uuid))
                            }
                        }
                    }

                    Section("2. קובץ") {
                        Button {
                            showFilePicker = true
                        } label: {
                            Label(fileName.isEmpty ? "בחר קובץ CSV" : fileName,
                                  systemImage: "doc.badge.arrow.up")
                        }
                        .disabled(accountUUID == nil)
                        Text("ייצא קובץ תנועות (CSV/Excel שנשמר כ-CSV) מאתר הבנק או חברת האשראי")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if fileText != nil {
                        Section("3. פורמט") {
                            Picker("מוסד", selection: $formatID) {
                                Text("זיהוי אוטומטי").tag(String?.none)
                                ForEach(BankFormat.all) { format in
                                    Text(format.name).tag(String?.some(format.id))
                                }
                            }
                            .onChange(of: formatID) { _, _ in parse() }
                        }
                    }

                    if !prepared.isEmpty {
                        Section("4. תצוגה מקדימה (\(prepared.count) תנועות, \(duplicates) כפילויות דולגו)") {
                            ForEach(prepared.prefix(8), id: \.fingerprint) { p in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(p.displayName)
                                        Text(Formatters.shortDate(p.row.date))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    AmountText(amount: p.row.amount)
                                }
                            }
                            if prepared.count > 8 {
                                Text("ועוד \(prepared.count - 8)...")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Button {
                                importNow()
                            } label: {
                                Label("ייבא \(prepared.count) תנועות", systemImage: "square.and.arrow.down.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }

                    if let errorMessage {
                        Section {
                            Label(errorMessage, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(Theme.over)
                        }
                    }
                }
            }
            .navigationTitle("ייבוא מקובץ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("סגור") { dismiss() } }
            }
            .fileImporter(isPresented: $showFilePicker,
                          allowedContentTypes: [.commaSeparatedText, .plainText, .data]) { result in
                handleFile(result)
            }
        }
    }

    private var doneSection: some View {
        Section {
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Theme.income)
                Text("יובאו \(prepared.count) תנועות").font(.headline)
                Text("תנועות ללא קטגוריה ודאית ממתינות בתור הבדיקה")
                    .font(.caption).foregroundStyle(.secondary)
                Button("סיום") { dismiss() }.buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical)
        }
    }

    private func handleFile(_ result: Result<URL, Error>) {
        errorMessage = nil
        guard case .success(let url) = result else { return }
        guard url.startAccessingSecurityScopedResource() else {
            errorMessage = "אין גישה לקובץ"
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let data = try? Data(contentsOf: url) else {
            errorMessage = "קריאת הקובץ נכשלה"
            return
        }
        // קבצי בנקים ישראליים מגיעים לרוב ב-UTF-8 או Windows-1255
        let text = String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .windowsCP1255)
        guard let text else {
            errorMessage = "קידוד הקובץ אינו נתמך"
            return
        }
        fileText = text
        fileName = url.lastPathComponent
        parse()
    }

    private func parse() {
        errorMessage = nil
        prepared = []
        duplicates = 0
        guard let text = fileText, let account = selectedAccount else { return }
        let rows = CSVParser.parse(text)
        guard !rows.isEmpty else {
            errorMessage = "הקובץ ריק או אינו CSV תקין"
            return
        }

        let format: BankFormat?
        if let formatID {
            format = BankFormat.all.first { $0.id == formatID }
        } else {
            format = rows.compactMap { BankFormat.detect(headerRow: $0) }.first
        }
        guard let format else {
            errorMessage = "לא זוהה פורמט — בחר מוסד ידנית"
            return
        }

        let mapped = BankFormatMapper.map(rows: rows, format: format)
        guard !mapped.isEmpty else {
            errorMessage = "לא נמצאו תנועות בקובץ (פורמט: \(format.name))"
            return
        }

        var engine = CategorizationEngine()
        engine.rules = rules.map(\.spec)
        engine.learned = CategorizationEngine.buildLearned(from: txns.compactMap { txn in
            guard txn.status == .reviewed, let cat = txn.category else { return nil }
            return (MerchantNormalizer.merchantKey(txn.rawMerchant), cat.uuid, txn.date)
        })

        let existing = Set(txns.map(\.fingerprint))
        let result = ImportService.prepare(rows: mapped,
                                           accountUUID: account.uuid,
                                           engine: engine,
                                           existingFingerprints: existing)
        prepared = result.new
        duplicates = result.duplicates
    }

    private func importNow() {
        guard let account = selectedAccount else { return }
        for p in prepared {
            let txn = Txn(amount: p.row.amount,
                          date: p.row.date,
                          rawMerchant: p.row.rawMerchant,
                          displayName: p.displayName,
                          account: account,
                          chargeDate: p.row.chargeDate,
                          installmentNumber: p.row.installmentNumber,
                          installmentCount: p.row.installmentCount,
                          fingerprint: p.fingerprint)
            txn.notes = p.row.notes

            if let suggestion = p.suggestion {
                if let uuid = suggestion.categoryUUID {
                    txn.category = categories.first { $0.uuid == uuid }
                } else if let name = suggestion.categoryName {
                    txn.category = categories.first { $0.name == name }
                }
                if suggestion.markTransfer { txn.isTransfer = true }
                // הצעה מחוק עם דילוג-בדיקה או הצעה נלמדת בטוחה — עדיין נשאיר לבדיקה
                // חוץ ממקרה של חוק מפורש
                if suggestion.source == .rule { txn.status = .reviewed }
            }

            // חיוב מרוכז של כרטיס אשראי בעו"ש — מסומן כהעברה אוטומטית
            let candidate = TransferCandidate(id: txn.uuid,
                                              accountUUID: account.uuid,
                                              accountKind: account.kind,
                                              amount: txn.amount,
                                              date: txn.date,
                                              merchantKey: MerchantNormalizer.merchantKey(txn.rawMerchant))
            if TransferMatcher.isCardSettlement(candidate) {
                txn.isTransfer = true
                txn.status = .reviewed
            }
            context.insert(txn)
        }
        try? context.save()
        imported = true
    }
}

extension String.Encoding {
    /// קידוד עברית ישן שעדיין נפוץ בקבצי ייצוא של בנקים.
    static let windowsCP1255 = String.Encoding(
        rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.windowsHebrew.rawValue)))
}
