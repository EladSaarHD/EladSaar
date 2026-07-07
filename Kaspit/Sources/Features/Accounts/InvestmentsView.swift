import SwiftUI
import SwiftData
import Charts

struct InvestmentsView: View {
    @Query private var holdings: [Holding]
    @Query private var accounts: [Account]
    @Environment(\.modelContext) private var context
    @State private var showAdd = false

    private var totalValue: Decimal { holdings.reduce(0) { $0 + $1.marketValue } }
    private var totalCost: Decimal { holdings.reduce(0) { $0 + $1.costBasis } }
    private var totalGain: Decimal { totalValue - totalCost }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("שווי התיק").font(.caption).foregroundStyle(.secondary)
                    Text(Formatters.currency(totalValue))
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .monospacedDigit()
                    HStack(spacing: 4) {
                        Image(systemName: totalGain >= 0 ? "arrow.up.right" : "arrow.down.right")
                        Text(Formatters.currency(totalGain.abs))
                        if totalCost > 0 {
                            Text("(\(String(format: "%.1f", (totalGain.doubleValue / totalCost.doubleValue) * 100))%)")
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(totalGain >= 0 ? Theme.income : Theme.over)
                }
                .padding(.vertical, 4)
            }

            Section("אחזקות") {
                ForEach(holdings, id: \.uuid) { holding in
                    NavigationLink {
                        HoldingEditorView(holding: holding)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(holding.symbol).font(.headline)
                                Text(holding.name).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(Formatters.currency(holding.marketValue, code: holding.currencyCode))
                                    .monospacedDigit()
                                Text(String(format: "%+.1f%%", holding.gainPercent))
                                    .font(.caption)
                                    .foregroundStyle(holding.gain >= 0 ? Theme.income : Theme.over)
                            }
                        }
                    }
                }
                .onDelete { offsets in
                    for i in offsets { context.delete(holdings[i]) }
                    try? context.save()
                }
                if holdings.isEmpty {
                    Text("הוסף אחזקות: מניות ת\"א, מניות ארה\"ב, קרנות סל, קריפטו. עדכון שערים אוטומטי — בשלב הבא במפת הדרכים.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("תיק השקעות")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showAdd = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showAdd) {
            NavigationStack { HoldingEditorView() }
        }
    }
}

struct HoldingEditorView: View {
    var holding: Holding?
    @Query private var accounts: [Account]
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var symbol = ""
    @State private var name = ""
    @State private var quantityText = ""
    @State private var costText = ""
    @State private var priceText = ""
    @State private var currencyCode = "ILS"
    @State private var accountUUID: UUID?

    var body: some View {
        Form {
            TextField("סימול (AAPL / מספר נייר בת\"א)", text: $symbol)
            TextField("שם", text: $name)
            TextField("כמות", text: $quantityText).keyboardType(.decimalPad)
            TextField("עלות כוללת", text: $costText).keyboardType(.decimalPad)
            TextField("שער נוכחי", text: $priceText).keyboardType(.decimalPad)
            Picker("מטבע", selection: $currencyCode) {
                Text("₪").tag("ILS"); Text("$").tag("USD"); Text("€").tag("EUR")
            }
            Picker("חשבון", selection: $accountUUID) {
                Text("ללא").tag(UUID?.none)
                ForEach(accounts.filter { $0.kind == .brokerage }, id: \.uuid) { acc in
                    Text(acc.name).tag(UUID?.some(acc.uuid))
                }
            }
        }
        .navigationTitle(holding == nil ? "אחזקה חדשה" : symbol)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("ביטול") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("שמור") { save() }.disabled(symbol.isEmpty)
            }
        }
        .onAppear {
            if let h = holding {
                symbol = h.symbol; name = h.name
                quantityText = "\(h.quantity)"; costText = "\(h.costBasis)"
                priceText = "\(h.lastPrice)"; currencyCode = h.currencyCode
                accountUUID = h.account?.uuid
            }
        }
    }

    private func save() {
        let posix = Locale(identifier: "en_US_POSIX")
        let quantity = Decimal(string: quantityText, locale: posix) ?? 0
        let cost = Decimal(string: costText, locale: posix) ?? 0
        let price = Decimal(string: priceText, locale: posix) ?? 0
        let account = accounts.first { $0.uuid == accountUUID }

        if let h = holding {
            h.symbol = symbol; h.name = name; h.quantity = quantity
            h.costBasis = cost; h.lastPrice = price
            h.currencyCode = currencyCode; h.account = account
            h.lastPriceDate = Date()
        } else {
            context.insert(Holding(symbol: symbol, name: name, quantity: quantity,
                                   costBasis: cost, lastPrice: price,
                                   currencyCode: currencyCode, account: account))
        }
        try? context.save()
        dismiss()
    }
}
