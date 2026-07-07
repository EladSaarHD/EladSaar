import SwiftUI
import SwiftData
import Charts

struct AccountDetailView: View {
    @Bindable var account: Account
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var newBalanceText = ""
    @State private var showBalanceUpdate = false

    private var recentTxns: [Txn] {
        (account.transactions ?? []).sorted { $0.date > $1.date }
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        EmojiBadge(emoji: account.kind.emoji, size: 44)
                        VStack(alignment: .leading) {
                            Text(account.name).font(.headline)
                            Text(account.kind.label).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        AmountText(amount: account.currentBalance, code: account.currencyCode)
                            .font(.title3.bold())
                    }
                    if account.balanceHistory.count >= 2 {
                        Chart(account.balanceHistory, id: \.date) { point in
                            LineMark(x: .value("תאריך", point.date),
                                     y: .value("יתרה", point.balance.doubleValue))
                            .interpolationMethod(.catmullRom)
                            AreaMark(x: .value("תאריך", point.date),
                                     y: .value("יתרה", point.balance.doubleValue))
                            .opacity(0.1)
                        }
                        .chartXAxis(.hidden)
                        .frame(height: 100)
                    }
                }
                .padding(.vertical, 4)
            }

            Section {
                Button("עדכן יתרה") { showBalanceUpdate = true }
                if account.kind == .creditCard {
                    Picker("מועד חיוב", selection: $account.billingDay) {
                        Text("לא מוגדר").tag(Int?.none)
                        ForEach([1, 2, 10, 15, 25], id: \.self) { day in
                            Text("\(day) בחודש").tag(Int?.some(day))
                        }
                    }
                }
            }

            if !recentTxns.isEmpty {
                Section("תנועות אחרונות") {
                    ForEach(recentTxns.prefix(20), id: \.uuid) { txn in
                        TransactionRowView(txn: txn)
                    }
                }
            }

            Section {
                Button(account.isArchived ? "בטל ארכוב" : "העבר לארכיון") {
                    account.isArchived.toggle()
                    try? context.save()
                }
                Button("מחק חשבון", role: .destructive) {
                    context.delete(account)
                    try? context.save()
                    dismiss()
                }
            }
        }
        .navigationTitle(account.name)
        .navigationBarTitleDisplayMode(.inline)
        .alert("עדכון יתרה", isPresented: $showBalanceUpdate) {
            TextField("יתרה חדשה", text: $newBalanceText)
            Button("עדכן") {
                if let balance = Decimal(string: newBalanceText.replacingOccurrences(of: ",", with: ""),
                                         locale: Locale(identifier: "en_US_POSIX")) {
                    account.recordBalanceSnapshot(balance)
                    try? context.save()
                }
                newBalanceText = ""
            }
            Button("ביטול", role: .cancel) { newBalanceText = "" }
        } message: {
            Text("היתרה תישמר גם בהיסטוריית היתרות של החשבון")
        }
    }
}
