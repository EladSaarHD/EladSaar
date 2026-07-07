import SwiftUI
import SwiftData

/// הזנת תנועה ידנית מהירה.
struct AddTransactionView: View {
    @Query private var accounts: [Account]
    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var amountText = ""
    @State private var isExpense = true
    @State private var merchant = ""
    @State private var date = Date()
    @State private var accountUUID: UUID?
    @State private var categoryUUID: UUID?
    @State private var notes = ""

    private var amount: Decimal? {
        Decimal(string: amountText.replacingOccurrences(of: ",", with: ""),
                locale: Locale(identifier: "en_US_POSIX"))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("סוג", selection: $isExpense) {
                        Text("הוצאה").tag(true)
                        Text("הכנסה").tag(false)
                    }
                    .pickerStyle(.segmented)

                    TextField("סכום בש\"ח", text: $amountText)
                        .keyboardType(.decimalPad)
                        .font(.title2.bold())
                    TextField("בית עסק / תיאור", text: $merchant)
                        .onChange(of: merchant) { _, newValue in
                            // הצעת קטגוריה אוטומטית תוך כדי הקלדה
                            if categoryUUID == nil,
                               let match = MerchantNormalizer.lookup(newValue),
                               let cat = categories.first(where: { $0.name == match.categoryName }) {
                                categoryUUID = cat.uuid
                            }
                        }
                    DatePicker("תאריך", selection: $date, displayedComponents: .date)
                }

                Section {
                    Picker("חשבון", selection: $accountUUID) {
                        Text("בחר...").tag(UUID?.none)
                        ForEach(accounts.filter { $0.kind.isSpending }, id: \.uuid) { acc in
                            Text("\(acc.kind.emoji) \(acc.name)").tag(UUID?.some(acc.uuid))
                        }
                    }
                    Picker("קטגוריה", selection: $categoryUUID) {
                        Text("בחר...").tag(UUID?.none)
                        ForEach(categories.filter { !$0.isArchived && $0.kind == (isExpense ? .expense : .income) }, id: \.uuid) { cat in
                            Text("\(cat.emoji) \(cat.name)").tag(UUID?.some(cat.uuid))
                        }
                    }
                    TextField("הערות", text: $notes)
                }
            }
            .navigationTitle("תנועה חדשה")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ביטול") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("שמור") { save() }
                        .disabled(amount == nil || merchant.isEmpty || accountUUID == nil)
                }
            }
        }
    }

    private func save() {
        guard let value = amount, value > 0 else { return }
        let signed = isExpense ? -value : value
        let account = accounts.first { $0.uuid == accountUUID }
        let txn = Txn(amount: signed, date: date, rawMerchant: merchant, account: account)
        txn.category = categories.first { $0.uuid == categoryUUID }
        txn.notes = notes
        txn.status = txn.category != nil ? .reviewed : .needsReview
        txn.fingerprint = TxnFingerprint.make(accountUUID: account?.uuid ?? UUID(),
                                              date: date, amount: signed,
                                              rawMerchant: merchant, installmentNumber: nil)
        context.insert(txn)
        account?.currentBalance += signed
        try? context.save()
        dismiss()
    }
}
