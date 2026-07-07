import SwiftUI
import SwiftData

/// הוראות קבע ומנויים: זיהוי אוטומטי, לוח חיובים קרובים, התראות מחיר.
struct RecurringsView: View {
    @Query(sort: \RecurringItem.nextDate) private var items: [RecurringItem]
    @Query private var txns: [Txn]
    @Environment(\.modelContext) private var context

    private var active: [RecurringItem] { items.filter { !$0.isDismissed && !$0.isCancelled } }
    private var cancelled: [RecurringItem] { items.filter { $0.isCancelled } }

    private var monthlyTotal: Decimal {
        active.filter { $0.cycle == .monthly }.reduce(0) { $0 + $1.expectedAmount }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        VStack(alignment: .leading) {
                            Text("סה\"כ חודשי").font(.caption).foregroundStyle(.secondary)
                            Text(Formatters.currency(monthlyTotal)).font(.title2.bold()).monospacedDigit()
                        }
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text("מנויים פעילים").font(.caption).foregroundStyle(.secondary)
                            Text("\(active.count)").font(.title2.bold())
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section("קרובים") {
                    ForEach(active, id: \.uuid) { item in
                        recurringRow(item)
                    }
                    if active.isEmpty {
                        Text("עדיין לא זוהו חיובים חוזרים. ככל שייכנסו יותר תנועות, הזיהוי ישתפר.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if !cancelled.isEmpty {
                    Section("בוטלו") {
                        ForEach(cancelled, id: \.uuid) { item in
                            recurringRow(item)
                        }
                    }
                }
            }
            .navigationTitle("הוראות קבע")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        detectNow()
                    } label: {
                        Label("סרוק עכשיו", systemImage: "sparkles")
                    }
                }
            }
            .task { detectNow() }
        }
    }

    @ViewBuilder
    private func recurringRow(_ item: RecurringItem) -> some View {
        HStack(spacing: 12) {
            EmojiBadge(emoji: item.emoji)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.displayName)
                HStack(spacing: 4) {
                    Text(item.cycle.label)
                    Text("· הבא: \(Formatters.shortDate(item.nextDate))")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Formatters.currency(item.expectedAmount)).monospacedDigit()
                if item.priceIncreased {
                    Label("עליית מחיר", systemImage: "arrow.up.right")
                        .font(.caption2)
                        .foregroundStyle(Theme.over)
                }
            }
        }
        .swipeActions {
            if item.isCancelled {
                Button("החזר") { item.isCancelled = false }
            } else {
                Button("ביטלתי") { item.isCancelled = true }.tint(.orange)
                Button("לא מנוי", role: .destructive) { item.isDismissed = true }
            }
        }
    }

    /// הרצת הזיהוי על כל התנועות ועדכון/יצירת פריטים.
    private func detectNow() {
        let candidates = txns
            .filter { $0.amount < 0 && !$0.isTransfer }
            .map { txn in
                RecurringCandidateTxn(merchantKey: MerchantNormalizer.merchantKey(txn.rawMerchant),
                                      displayName: txn.displayName,
                                      date: txn.date,
                                      amount: txn.amount.abs)
            }
        let detected = RecurringDetector.detect(in: candidates)

        for d in detected {
            if let existing = items.first(where: { $0.merchantKey == d.merchantKey }) {
                if d.lastDate > existing.lastDate {
                    if existing.lastAmount != d.lastAmount {
                        existing.priceHistory.append(PricePoint(date: d.lastDate, amount: d.lastAmount))
                    }
                    existing.lastAmount = d.lastAmount
                    existing.lastDate = d.lastDate
                    existing.nextDate = d.nextDate
                    existing.expectedAmount = d.expectedAmount
                }
            } else {
                let item = RecurringItem(merchantKey: d.merchantKey,
                                         displayName: d.displayName,
                                         cycle: d.cycle,
                                         expectedAmount: d.expectedAmount,
                                         lastAmount: d.lastAmount,
                                         lastDate: d.lastDate,
                                         nextDate: d.nextDate)
                context.insert(item)
                NotificationService.shared.scheduleUpcomingRecurring(item)
            }
        }
        try? context.save()
    }
}
