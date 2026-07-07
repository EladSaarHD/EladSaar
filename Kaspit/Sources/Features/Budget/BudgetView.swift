import SwiftUI
import SwiftData

struct BudgetView: View {
    @Query private var txns: [Txn]
    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Query private var entries: [BudgetEntry]
    @Environment(\.modelContext) private var context
    @AppStorage("useChargeDate") private var useChargeDate = false

    @State private var monthKey = MonthKey.key(for: Date())
    @State private var editingCategory: Category?
    @State private var showRebalance = false

    private var monthEntries: [BudgetEntry] { entries.filter { $0.monthKey == monthKey } }
    private var spent: [UUID: Decimal] {
        BudgetMath.spentByCategory(txns, monthKey: monthKey, useChargeDate: useChargeDate)
    }

    private var totalBudget: Decimal { monthEntries.reduce(0) { $0 + $1.amount } }
    private var totalSpent: Decimal {
        BudgetMath.totalExpenses(txns, monthKey: monthKey, useChargeDate: useChargeDate)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    monthHeader
                    VStack(spacing: 8) {
                        HStack {
                            Text("סה\"כ החודש").font(.headline)
                            Spacer()
                            Text("\(Formatters.currency(totalSpent)) מתוך \(Formatters.currency(totalBudget))")
                                .font(.subheadline).monospacedDigit()
                        }
                        BudgetProgressBar(fraction: totalBudget > 0 ? totalSpent.doubleValue / totalBudget.doubleValue : 0)
                    }
                    .padding(.vertical, 4)
                }

                ForEach(groupedCategories, id: \.0) { group, cats in
                    Section(group.isEmpty ? "כללי" : group) {
                        ForEach(cats, id: \.uuid) { cat in
                            categoryRow(cat)
                                .contentShape(Rectangle())
                                .onTapGesture { editingCategory = cat }
                        }
                    }
                }
            }
            .navigationTitle("תקציב")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("איזון מחדש") { showRebalance = true }
                        Button("העתק תקציב מחודש קודם") { copyFromPreviousMonth() }
                        Toggle("תצוגה לפי מועד חיוב", isOn: $useChargeDate)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(item: $editingCategory) { cat in
                BudgetEditorView(category: cat, monthKey: monthKey)
                    .presentationDetents([.medium])
            }
            .sheet(isPresented: $showRebalance) {
                RebalanceView(monthKey: monthKey)
                    .presentationDetents([.medium])
            }
        }
    }

    private var monthHeader: some View {
        HStack {
            Button { monthKey = MonthKey.previous(monthKey) } label: {
                Image(systemName: "chevron.forward")
            }
            Spacer()
            Text(MonthKey.label(monthKey)).font(.headline)
            Spacer()
            Button { monthKey = MonthKey.next(monthKey) } label: {
                Image(systemName: "chevron.backward")
            }
        }
        .buttonStyle(.plain)
    }

    private var groupedCategories: [(String, [Category])] {
        let visible = categories.filter { !$0.isArchived && $0.kind == .expense }
        let groups = Dictionary(grouping: visible, by: { $0.group })
        return groups.sorted { $0.key < $1.key }
    }

    @ViewBuilder
    private func categoryRow(_ cat: Category) -> some View {
        let entry = monthEntries.first { $0.category?.uuid == cat.uuid }
        let budget = entry?.amount ?? 0
        let rollover = (entry?.rollover ?? false)
            ? BudgetMath.rolloverAmount(categoryUUID: cat.uuid, monthKey: monthKey,
                                        entries: entries, allTxns: txns, useChargeDate: useChargeDate)
            : 0
        let available = budget + rollover
        let catSpent = spent[cat.uuid] ?? 0

        VStack(spacing: 6) {
            HStack {
                Text("\(cat.emoji) \(cat.name)")
                if rollover != 0 {
                    Text(rollover > 0 ? "+\(Formatters.currency(rollover)) גלגול" : "\(Formatters.currency(rollover)) גלגול")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if available > 0 {
                    Text("\(Formatters.currency(catSpent)) / \(Formatters.currency(available))")
                        .font(.caption).monospacedDigit()
                        .foregroundStyle(catSpent > available ? Theme.over : .secondary)
                } else if catSpent > 0 {
                    Text(Formatters.currency(catSpent))
                        .font(.caption).monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
            if available > 0 {
                BudgetProgressBar(fraction: catSpent.doubleValue / available.doubleValue)
            }
        }
        .padding(.vertical, 2)
    }

    /// הצעת תקציב: העתקת החודש הקודם, ואם אין — ממוצע 3 חודשים אחרונים.
    private func copyFromPreviousMonth() {
        let prevKey = MonthKey.previous(monthKey)
        let prevEntries = entries.filter { $0.monthKey == prevKey }
        if !prevEntries.isEmpty {
            for prev in prevEntries where !monthEntries.contains(where: { $0.category?.uuid == prev.category?.uuid }) {
                context.insert(BudgetEntry(category: prev.category, monthKey: monthKey,
                                           amount: prev.amount, rollover: prev.rollover))
            }
        } else {
            for cat in categories where cat.kind == .expense && !cat.isArchived {
                var total: Decimal = 0
                var key = monthKey
                for _ in 0..<3 {
                    key = MonthKey.previous(key)
                    total += BudgetMath.spentByCategory(txns, monthKey: key, useChargeDate: useChargeDate)[cat.uuid] ?? 0
                }
                let avg = total / 3
                if avg > 0 {
                    context.insert(BudgetEntry(category: cat, monthKey: monthKey, amount: avg))
                }
            }
        }
        try? context.save()
    }
}

/// עריכת תקציב חודשי לקטגוריה, כולל גלגול יתרה.
struct BudgetEditorView: View {
    let category: Category
    let monthKey: String
    @Query private var entries: [BudgetEntry]
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var amountText = ""
    @State private var rollover = false

    private var entry: BudgetEntry? {
        entries.first { $0.monthKey == monthKey && $0.category?.uuid == category.uuid }
    }

    var body: some View {
        NavigationStack {
            Form {
                LabeledContent("קטגוריה", value: "\(category.emoji) \(category.name)")
                TextField("תקציב חודשי בש\"ח", text: $amountText)
                    .keyboardType(.decimalPad)
                Toggle("גלגול יתרה לחודש הבא", isOn: $rollover)
            }
            .navigationTitle("תקציב \(MonthKey.label(monthKey))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ביטול") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("שמור") { save() }
                }
            }
            .onAppear {
                if let entry {
                    amountText = "\(entry.amount)"
                    rollover = entry.rollover
                }
            }
        }
    }

    private func save() {
        let amount = Decimal(string: amountText, locale: Locale(identifier: "en_US_POSIX")) ?? 0
        if let entry {
            entry.amount = amount
            entry.rollover = rollover
        } else if amount > 0 {
            context.insert(BudgetEntry(category: category, monthKey: monthKey,
                                       amount: amount, rollover: rollover))
        }
        try? context.save()
        dismiss()
    }
}

/// איזון מחדש: העברת תקציב מקטגוריה עם עודף לקטגוריה בחוסר.
struct RebalanceView: View {
    let monthKey: String
    @Query private var entries: [BudgetEntry]
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var fromUUID: UUID?
    @State private var toUUID: UUID?
    @State private var amountText = ""

    private var monthEntries: [BudgetEntry] {
        entries.filter { $0.monthKey == monthKey && $0.category != nil }
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("מקטגוריה", selection: $fromUUID) {
                    Text("בחר...").tag(UUID?.none)
                    ForEach(monthEntries, id: \.uuid) { entry in
                        Text("\(entry.category!.emoji) \(entry.category!.name) (\(Formatters.currency(entry.amount)))")
                            .tag(UUID?.some(entry.category!.uuid))
                    }
                }
                Picker("לקטגוריה", selection: $toUUID) {
                    Text("בחר...").tag(UUID?.none)
                    ForEach(monthEntries, id: \.uuid) { entry in
                        Text("\(entry.category!.emoji) \(entry.category!.name)")
                            .tag(UUID?.some(entry.category!.uuid))
                    }
                }
                TextField("סכום להעברה", text: $amountText)
                    .keyboardType(.decimalPad)
            }
            .navigationTitle("איזון מחדש")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ביטול") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("העבר") { rebalance() }
                        .disabled(fromUUID == nil || toUUID == nil || fromUUID == toUUID)
                }
            }
        }
    }

    private func rebalance() {
        guard let amount = Decimal(string: amountText, locale: Locale(identifier: "en_US_POSIX")),
              amount > 0,
              let from = monthEntries.first(where: { $0.category?.uuid == fromUUID }),
              let to = monthEntries.first(where: { $0.category?.uuid == toUUID }) else { return }
        from.amount -= amount
        to.amount += amount
        try? context.save()
        dismiss()
    }
}
