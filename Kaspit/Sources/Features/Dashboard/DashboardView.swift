import SwiftUI
import SwiftData
import Charts

struct DashboardView: View {
    @Query private var txns: [Txn]
    @Query private var accounts: [Account]
    @Query private var budgetEntries: [BudgetEntry]
    @Query(sort: \RecurringItem.nextDate) private var recurrings: [RecurringItem]
    @Query(sort: \NetWorthSnapshot.date) private var snapshots: [NetWorthSnapshot]
    @AppStorage("useChargeDate") private var useChargeDate = false

    @State private var showReview = false
    @State private var showCashFlow = false
    @State private var showSettings = false

    private var monthKey: String { MonthKey.key(for: Date()) }
    private var toReview: [Txn] { txns.filter { $0.status == .needsReview && !$0.isHidden } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    reviewCard
                    netIncomeCard
                    trendingBudgetsCard
                    upcomingCard
                    netWorthCard
                }
                .padding()
            }
            .navigationTitle("כספית")
            .background(Color(.systemGroupedBackground))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .sheet(isPresented: $showReview) { ReviewQueueView() }
            .sheet(isPresented: $showCashFlow) { CashFlowView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
        }
    }

    private var reviewCard: some View {
        Group {
            if toReview.isEmpty {
                DashboardCard(title: "הכול נבדק ✅") {
                    Text("אין תנועות חדשות לבדיקה")
                        .foregroundStyle(.secondary)
                }
            } else {
                Button { showReview = true } label: {
                    DashboardCard(title: "תנועות לבדיקה", systemImage: "chevron.backward") {
                        HStack {
                            Text("\(toReview.count)")
                                .font(.system(size: 40, weight: .bold, design: .rounded))
                                .foregroundStyle(.tint)
                            VStack(alignment: .leading) {
                                Text("תנועות ממתינות לאישור קטגוריה")
                                Text("החלק לאישור, הקש לתיקון")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var netIncomeCard: some View {
        let income = BudgetMath.totalIncome(txns, monthKey: monthKey, useChargeDate: useChargeDate)
        let expenses = BudgetMath.totalExpenses(txns, monthKey: monthKey, useChargeDate: useChargeDate)
        let prevKey = MonthKey.previous(monthKey)
        let prevNet = BudgetMath.totalIncome(txns, monthKey: prevKey, useChargeDate: useChargeDate)
            - BudgetMath.totalExpenses(txns, monthKey: prevKey, useChargeDate: useChargeDate)
        let net = income - expenses

        return Button { showCashFlow = true } label: {
            DashboardCard(title: "החודש", systemImage: "chart.bar.xaxis") {
                HStack(spacing: 24) {
                    VStack(alignment: .leading) {
                        Text("הכנסות").font(.caption).foregroundStyle(.secondary)
                        AmountText(amount: income).font(.headline)
                    }
                    VStack(alignment: .leading) {
                        Text("הוצאות").font(.caption).foregroundStyle(.secondary)
                        Text(Formatters.currency(expenses)).font(.headline).monospacedDigit()
                    }
                    VStack(alignment: .leading) {
                        Text("נטו").font(.caption).foregroundStyle(.secondary)
                        AmountText(amount: net, showSign: true).font(.headline)
                    }
                    Spacer()
                }
                Text(net >= prevNet
                     ? "יותר טוב מ\(MonthKey.label(prevKey)) 👏"
                     : "פחות טוב מ\(MonthKey.label(prevKey))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }

    private var trendingBudgetsCard: some View {
        let spent = BudgetMath.spentByCategory(txns, monthKey: monthKey, useChargeDate: useChargeDate)
        let entries = budgetEntries.filter { $0.monthKey == monthKey && $0.category != nil }
        let rows: [(Category, Decimal, Decimal)] = entries.compactMap { entry in
            guard let cat = entry.category, entry.amount > 0 else { return nil }
            return (cat, spent[cat.uuid] ?? 0, entry.amount)
        }
        .sorted { ($0.1 / $0.2) > ($1.1 / $1.2) }
        .prefix(4).map { $0 }

        return Group {
            if !rows.isEmpty {
                DashboardCard(title: "קטגוריות חמות החודש", systemImage: "flame") {
                    ForEach(rows, id: \.0.uuid) { cat, catSpent, budget in
                        VStack(spacing: 4) {
                            HStack {
                                Text("\(cat.emoji) \(cat.name)").font(.subheadline)
                                Spacer()
                                Text("\(Formatters.currency(catSpent)) מתוך \(Formatters.currency(budget))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            BudgetProgressBar(fraction: catSpent.doubleValue / budget.doubleValue)
                        }
                    }
                }
            }
        }
    }

    private var upcomingCard: some View {
        let upcoming = recurrings
            .filter { !$0.isCancelled && !$0.isDismissed && $0.nextDate > Date().addingTimeInterval(-86_400) }
            .prefix(4)
        return Group {
            if !upcoming.isEmpty {
                DashboardCard(title: "חיובים קרובים", systemImage: "calendar") {
                    ForEach(Array(upcoming), id: \.uuid) { item in
                        HStack {
                            Text(item.emoji)
                            VStack(alignment: .leading) {
                                Text(item.displayName).font(.subheadline)
                                Text(Formatters.shortDate(item.nextDate))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Formatters.currency(item.expectedAmount))
                                .monospacedDigit()
                            if item.priceIncreased {
                                Image(systemName: "arrow.up.circle.fill").foregroundStyle(Theme.over)
                            }
                        }
                    }
                }
            }
        }
    }

    private var netWorthCard: some View {
        let assets = accounts.filter { !$0.kind.isLiability && !$0.isArchived }
            .reduce(Decimal(0)) { $0 + $1.currentBalance }
        let liabilities = accounts.filter { $0.kind.isLiability && !$0.isArchived }
            .reduce(Decimal(0)) { $0 + $1.currentBalance.abs }
        let net = assets - liabilities

        return DashboardCard(title: "שווי נקי", systemImage: "chart.line.uptrend.xyaxis") {
            AmountText(amount: net).font(.system(size: 32, weight: .bold, design: .rounded))
            if snapshots.count >= 2 {
                Chart(snapshots.suffix(12), id: \.uuid) { snap in
                    LineMark(x: .value("תאריך", snap.date),
                             y: .value("שווי", snap.netWorth.doubleValue))
                    .interpolationMethod(.catmullRom)
                }
                .chartXAxis(.hidden)
                .frame(height: 60)
            }
        }
    }
}
