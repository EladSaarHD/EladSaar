import SwiftUI
import SwiftData

struct AccountsView: View {
    @Query(sort: \Account.createdAt) private var accounts: [Account]
    @Query private var snapshots: [NetWorthSnapshot]
    @Environment(\.modelContext) private var context
    @State private var showAdd = false

    private var visible: [Account] { accounts.filter { !$0.isArchived } }
    private var assets: Decimal {
        visible.filter { !$0.kind.isLiability }.reduce(0) { $0 + $1.currentBalance }
    }
    private var liabilities: Decimal {
        visible.filter { $0.kind.isLiability }.reduce(0) { $0 + $1.currentBalance.abs }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        NetWorthView()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("שווי נקי").font(.caption).foregroundStyle(.secondary)
                            AmountText(amount: assets - liabilities)
                                .font(.system(size: 30, weight: .bold, design: .rounded))
                            Text("נכסים \(Formatters.currency(assets)) · התחייבויות \(Formatters.currency(liabilities))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }

                ForEach(groupedAccounts, id: \.0) { kind, group in
                    Section(kind.label) {
                        ForEach(group, id: \.uuid) { account in
                            NavigationLink {
                                AccountDetailView(account: account)
                            } label: {
                                accountRow(account)
                            }
                        }
                    }
                }

                Section {
                    NavigationLink { GoalsView() } label: {
                        Label("יעדי חיסכון", systemImage: "target")
                    }
                    NavigationLink { InvestmentsView() } label: {
                        Label("תיק השקעות", systemImage: "chart.line.uptrend.xyaxis")
                    }
                }
            }
            .navigationTitle("חשבונות")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAdd = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showAdd) { AddAccountView() }
            .task { snapshotNetWorthIfNeeded() }
        }
    }

    private var groupedAccounts: [(AccountKind, [Account])] {
        let groups = Dictionary(grouping: visible, by: { $0.kind })
        return AccountKind.allCases.compactMap { kind in
            guard let group = groups[kind], !group.isEmpty else { return nil }
            return (kind, group)
        }
    }

    private func accountRow(_ account: Account) -> some View {
        HStack(spacing: 12) {
            EmojiBadge(emoji: account.kind.emoji)
            VStack(alignment: .leading, spacing: 2) {
                Text(account.name)
                if !account.institution.isEmpty {
                    Text(account.institution).font(.caption).foregroundStyle(.secondary)
                }
                if account.kind == .creditCard, let day = account.billingDay {
                    Text("מועד חיוב: \(day) בחודש").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            AmountText(amount: account.currentBalance, code: account.currencyCode)
        }
    }

    /// snapshot חודשי אוטומטי לשווי הנקי.
    private func snapshotNetWorthIfNeeded() {
        let currentKey = MonthKey.key(for: Date())
        let hasThisMonth = snapshots.contains { MonthKey.key(for: $0.date) == currentKey }
        guard !hasThisMonth, !visible.isEmpty else { return }
        context.insert(NetWorthSnapshot(date: Date(), totalAssets: assets, totalLiabilities: liabilities))
        try? context.save()
    }
}

struct AddAccountView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var kind: AccountKind = .checking
    @State private var institution = ""
    @State private var balanceText = ""
    @State private var billingDay = 10
    @State private var currencyCode = "ILS"

    var body: some View {
        NavigationStack {
            Form {
                TextField("שם החשבון", text: $name)
                Picker("סוג", selection: $kind) {
                    ForEach(AccountKind.allCases) { k in
                        Text("\(k.emoji) \(k.label)").tag(k)
                    }
                }
                TextField("מוסד (לאומי, ישראכרט...)", text: $institution)
                TextField("יתרה נוכחית", text: $balanceText)
                    .keyboardType(.numbersAndPunctuation)
                if kind == .creditCard {
                    Picker("מועד חיוב חודשי", selection: $billingDay) {
                        ForEach([1, 2, 10, 15, 25], id: \.self) { day in
                            Text("\(day) בחודש").tag(day)
                        }
                    }
                }
                Picker("מטבע", selection: $currencyCode) {
                    Text("₪ שקל").tag("ILS")
                    Text("$ דולר").tag("USD")
                    Text("€ אירו").tag("EUR")
                }
            }
            .navigationTitle("חשבון חדש")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ביטול") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("שמור") { save() }.disabled(name.isEmpty)
                }
            }
        }
    }

    private func save() {
        let account = Account(name: name, kind: kind, currencyCode: currencyCode,
                              institution: institution,
                              billingDay: kind == .creditCard ? billingDay : nil)
        let balance = Decimal(string: balanceText.replacingOccurrences(of: ",", with: ""),
                              locale: Locale(identifier: "en_US_POSIX")) ?? 0
        account.recordBalanceSnapshot(balance)
        context.insert(account)
        try? context.save()
        dismiss()
    }
}
