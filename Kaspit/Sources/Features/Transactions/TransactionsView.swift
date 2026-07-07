import SwiftUI
import SwiftData

struct TxnFilter: Equatable {
    var accountUUID: UUID?
    var categoryUUID: UUID?
    var tag: String?
    var onlyUnreviewed = false
    var showHidden = false

    var isActive: Bool {
        accountUUID != nil || categoryUUID != nil || tag != nil || onlyUnreviewed || showHidden
    }
}

struct TransactionsView: View {
    @Query(sort: \Txn.date, order: .reverse) private var txns: [Txn]
    @State private var search = ""
    @State private var filter = TxnFilter()
    @State private var showFilter = false
    @State private var showAdd = false
    @State private var showImport = false

    private var filtered: [Txn] {
        txns.filter { txn in
            if !filter.showHidden && txn.isHidden { return false }
            if filter.onlyUnreviewed && txn.status != .needsReview { return false }
            if let acc = filter.accountUUID, txn.account?.uuid != acc { return false }
            if let cat = filter.categoryUUID, txn.category?.uuid != cat { return false }
            if let tag = filter.tag, !txn.tags.contains(tag) { return false }
            if !search.isEmpty {
                let q = search.lowercased()
                let haystack = "\(txn.displayName) \(txn.rawMerchant) \(txn.notes) \(txn.tags.joined(separator: " "))".lowercased()
                if !haystack.contains(q) { return false }
            }
            return true
        }
    }

    private var grouped: [(Date, [Txn])] {
        let groups = Dictionary(grouping: filtered) { Calendar.current.startOfDay(for: $0.date) }
        return groups.sorted { $0.key > $1.key }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(grouped, id: \.0) { day, dayTxns in
                    Section(Formatters.dayLabel(day)) {
                        ForEach(dayTxns, id: \.uuid) { txn in
                            NavigationLink(value: txn.uuid) {
                                TransactionRowView(txn: txn)
                            }
                        }
                    }
                }
                if filtered.isEmpty {
                    ContentUnavailableView("אין תנועות",
                                           systemImage: "tray",
                                           description: Text("הוסף תנועה ידנית או ייבא קובץ מהבנק"))
                }
            }
            .navigationTitle("תנועות")
            .searchable(text: $search, prompt: "חיפוש בית עסק, תגית, הערה...")
            .navigationDestination(for: UUID.self) { uuid in
                if let txn = txns.first(where: { $0.uuid == uuid }) {
                    TransactionDetailView(txn: txn)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showFilter = true
                    } label: {
                        Image(systemName: filter.isActive
                              ? "line.3.horizontal.decrease.circle.fill"
                              : "line.3.horizontal.decrease.circle")
                    }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { showImport = true } label: { Image(systemName: "square.and.arrow.down") }
                    Button { showAdd = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showFilter) { FilterSheet(filter: $filter) }
            .sheet(isPresented: $showAdd) { AddTransactionView() }
            .sheet(isPresented: $showImport) { ImportWizardView() }
        }
    }
}

struct TransactionRowView: View {
    let txn: Txn

    var body: some View {
        HStack(spacing: 12) {
            EmojiBadge(emoji: txn.isTransfer ? "🔁" : (txn.category?.emoji ?? "❓"))
            VStack(alignment: .leading, spacing: 2) {
                Text(txn.displayName)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let cat = txn.category {
                        Text(cat.name)
                    } else {
                        Text("ללא קטגוריה").foregroundStyle(Theme.warning)
                    }
                    if let inst = txn.installmentLabel {
                        Text("· \(inst)")
                    }
                    ForEach(txn.tags, id: \.self) { tag in
                        Text("#\(tag)")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                AmountText(amount: txn.amount)
                if txn.status == .needsReview {
                    Circle().fill(.tint).frame(width: 8, height: 8)
                }
            }
        }
        .opacity(txn.isHidden ? 0.4 : 1)
    }
}

struct FilterSheet: View {
    @Binding var filter: TxnFilter
    @Query private var accounts: [Account]
    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Picker("חשבון", selection: $filter.accountUUID) {
                    Text("הכול").tag(UUID?.none)
                    ForEach(accounts, id: \.uuid) { acc in
                        Text(acc.name).tag(UUID?.some(acc.uuid))
                    }
                }
                Picker("קטגוריה", selection: $filter.categoryUUID) {
                    Text("הכול").tag(UUID?.none)
                    ForEach(categories.filter { !$0.isArchived }, id: \.uuid) { cat in
                        Text("\(cat.emoji) \(cat.name)").tag(UUID?.some(cat.uuid))
                    }
                }
                Toggle("רק תנועות לבדיקה", isOn: $filter.onlyUnreviewed)
                Toggle("הצג תנועות מוסתרות", isOn: $filter.showHidden)
                Button("נקה סינון", role: .destructive) {
                    filter = TxnFilter()
                    dismiss()
                }
            }
            .navigationTitle("סינון")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("סגור") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
