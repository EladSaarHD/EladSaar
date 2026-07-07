import SwiftUI
import SwiftData
import Charts

struct NetWorthView: View {
    @Query(sort: \NetWorthSnapshot.date) private var snapshots: [NetWorthSnapshot]
    @Query private var accounts: [Account]

    private var visible: [Account] { accounts.filter { !$0.isArchived } }

    /// פירוק לפי סוג נכס.
    private var breakdown: [(String, Decimal)] {
        let liquid = visible.filter { [.checking, .savings, .cash].contains($0.kind) }
            .reduce(Decimal(0)) { $0 + $1.currentBalance }
        let investments = visible.filter { $0.kind == .brokerage }
            .reduce(Decimal(0)) { $0 + $1.currentBalance }
        let pension = visible.filter { [.pension, .studyFund, .providentFund].contains($0.kind) }
            .reduce(Decimal(0)) { $0 + $1.currentBalance }
        let realEstate = visible.filter { $0.kind == .asset }
            .reduce(Decimal(0)) { $0 + $1.currentBalance }
        let debt = visible.filter { $0.kind.isLiability }
            .reduce(Decimal(0)) { $0 + $1.currentBalance.abs }
        return [
            ("נזיל", liquid),
            ("השקעות", investments),
            ("פנסיוני", pension),
            ("נדל\"ן ונכסים", realEstate),
            ("חובות", -debt),
        ].filter { $0.1 != 0 }
    }

    var body: some View {
        List {
            Section {
                if snapshots.count >= 2 {
                    Chart(snapshots, id: \.uuid) { snap in
                        LineMark(x: .value("תאריך", snap.date),
                                 y: .value("שווי נקי", snap.netWorth.doubleValue))
                        .interpolationMethod(.catmullRom)
                        AreaMark(x: .value("תאריך", snap.date),
                                 y: .value("שווי נקי", snap.netWorth.doubleValue))
                        .opacity(0.1)
                    }
                    .frame(height: 200)
                    .padding(.vertical)
                } else {
                    Text("גרף השווי הנקי ייבנה עם הזמן — צילום מצב נשמר אוטומטית פעם בחודש.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("פירוק") {
                ForEach(breakdown, id: \.0) { label, amount in
                    HStack {
                        Text(label)
                        Spacer()
                        AmountText(amount: amount)
                    }
                }
            }

            Section {
                Text("טיפ: הוסף את הדירה כחשבון מסוג \"נכס\" עם שווי מוערך, ואת המשכנתא כחשבון \"משכנתא\" — והשווי הנקי יכלול אותם.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("שווי נקי")
    }
}
