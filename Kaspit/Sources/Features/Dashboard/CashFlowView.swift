import SwiftUI
import SwiftData
import Charts

/// תזרים מזומנים: הכנסות / הוצאות / נטו לאורך החודשים האחרונים.
struct CashFlowView: View {
    @Query private var txns: [Txn]
    @AppStorage("useChargeDate") private var useChargeDate = false
    @Environment(\.dismiss) private var dismiss
    @State private var monthsBack = 6

    private var data: [(monthKey: String, income: Decimal, expenses: Decimal)] {
        BudgetMath.monthlyCashFlow(txns, monthsBack: monthsBack, useChargeDate: useChargeDate)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Picker("טווח", selection: $monthsBack) {
                        Text("3 חודשים").tag(3)
                        Text("6 חודשים").tag(6)
                        Text("שנה").tag(12)
                    }
                    .pickerStyle(.segmented)

                    Chart {
                        ForEach(data, id: \.monthKey) { item in
                            BarMark(x: .value("חודש", MonthKey.label(item.monthKey)),
                                    y: .value("סכום", item.income.doubleValue))
                            .foregroundStyle(Theme.income)
                            .position(by: .value("סוג", "הכנסות"))
                            BarMark(x: .value("חודש", MonthKey.label(item.monthKey)),
                                    y: .value("סכום", item.expenses.doubleValue))
                            .foregroundStyle(Theme.over)
                            .position(by: .value("סוג", "הוצאות"))
                        }
                    }
                    .frame(height: 220)

                    ForEach(data.reversed(), id: \.monthKey) { item in
                        let net = item.income - item.expenses
                        HStack {
                            Text(MonthKey.label(item.monthKey)).font(.subheadline)
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                AmountText(amount: net, showSign: true).font(.headline)
                                Text("הכנסות \(Formatters.currency(item.income)) · הוצאות \(Formatters.currency(item.expenses))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding()
                        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                .padding()
            }
            .navigationTitle("תזרים מזומנים")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("סגור") { dismiss() }
                }
            }
        }
    }
}
