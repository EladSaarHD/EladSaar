import SwiftUI
import SwiftData

struct GoalsView: View {
    @Query(sort: \Goal.createdAt) private var goals: [Goal]
    @Query private var accounts: [Account]
    @Query private var txns: [Txn]
    @Environment(\.modelContext) private var context
    @State private var showAdd = false

    var body: some View {
        List {
            ForEach(goals, id: \.uuid) { goal in
                goalRow(goal)
            }
            .onDelete { offsets in
                for i in offsets { context.delete(goals[i]) }
                try? context.save()
            }
            if goals.isEmpty {
                ContentUnavailableView("אין יעדים",
                                       systemImage: "target",
                                       description: Text("קבע יעד חיסכון — חופשה, מקדמה לדירה, קרן חירום — וקשר אליו חשבונות ותנועות"))
            }
        }
        .navigationTitle("יעדי חיסכון")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showAdd = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showAdd) { GoalEditorView() }
    }

    @ViewBuilder
    private func goalRow(_ goal: Goal) -> some View {
        let linked = accounts.filter { goal.linkedAccountUUIDs.contains($0.uuid) }
            .reduce(Decimal(0)) { $0 + $1.currentBalance }
        let tagged = txns.filter { $0.goalUUID == goal.uuid }
            .reduce(Decimal(0)) { $0 + $1.amount.abs }
        let progress = goal.progress(linkedAccountsBalance: linked, taggedTransactionsTotal: tagged)
        let fraction = goal.targetAmount > 0 ? progress.doubleValue / goal.targetAmount.doubleValue : 0

        VStack(spacing: 8) {
            HStack {
                EmojiBadge(emoji: goal.emoji)
                VStack(alignment: .leading, spacing: 2) {
                    Text(goal.name).font(.headline)
                    if let date = goal.targetDate {
                        Text("עד \(Formatters.shortDate(date))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Formatters.currency(progress)).monospacedDigit().font(.headline)
                    Text("מתוך \(Formatters.currency(goal.targetAmount))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            BudgetProgressBar(fraction: min(fraction, 1))
            if fraction >= 1 {
                Label("היעד הושג! 🎉", systemImage: "checkmark.seal.fill")
                    .font(.caption)
                    .foregroundStyle(Theme.income)
            }
        }
        .padding(.vertical, 4)
    }
}

struct GoalEditorView: View {
    @Query private var accounts: [Account]
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var emoji = "🎯"
    @State private var targetText = ""
    @State private var hasDate = false
    @State private var targetDate = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    @State private var linkedUUIDs: Set<UUID> = []

    var body: some View {
        NavigationStack {
            Form {
                TextField("שם היעד (חופשה ביפן...)", text: $name)
                TextField("אימוג'י", text: $emoji)
                TextField("סכום יעד בש\"ח", text: $targetText).keyboardType(.decimalPad)
                Toggle("תאריך יעד", isOn: $hasDate)
                if hasDate {
                    DatePicker("עד", selection: $targetDate, displayedComponents: .date)
                }
                Section("חשבונות מקושרים (היתרה נספרת ליעד)") {
                    ForEach(accounts.filter { [.savings, .brokerage, .cash].contains($0.kind) }, id: \.uuid) { acc in
                        Toggle("\(acc.kind.emoji) \(acc.name)", isOn: Binding(
                            get: { linkedUUIDs.contains(acc.uuid) },
                            set: { on in
                                if on { linkedUUIDs.insert(acc.uuid) } else { linkedUUIDs.remove(acc.uuid) }
                            }))
                    }
                }
            }
            .navigationTitle("יעד חדש")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ביטול") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("שמור") { save() }
                        .disabled(name.isEmpty || Decimal(string: targetText, locale: Locale(identifier: "en_US_POSIX")) == nil)
                }
            }
        }
    }

    private func save() {
        guard let target = Decimal(string: targetText, locale: Locale(identifier: "en_US_POSIX")) else { return }
        let goal = Goal(name: name,
                        emoji: emoji.isEmpty ? "🎯" : emoji,
                        targetAmount: target,
                        targetDate: hasDate ? targetDate : nil)
        goal.linkedAccountUUIDs = Array(linkedUUIDs)
        context.insert(goal)
        try? context.save()
        dismiss()
    }
}
