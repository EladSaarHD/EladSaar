import SwiftUI
import SwiftData

struct RulesListView: View {
    @Query(sort: \Rule.priority) private var rules: [Rule]
    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Environment(\.modelContext) private var context
    @State private var showEditor = false

    var body: some View {
        List {
            ForEach(rules, id: \.uuid) { rule in
                NavigationLink {
                    RuleEditorView(rule: rule)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(rule.name).font(.headline)
                            if !rule.isEnabled {
                                Text("כבוי").font(.caption2)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color(.tertiarySystemFill), in: Capsule())
                            }
                        }
                        Text(summary(rule))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .onDelete { offsets in
                for i in offsets { context.delete(rules[i]) }
                try? context.save()
            }
            if rules.isEmpty {
                ContentUnavailableView("אין חוקים",
                                       systemImage: "wand.and.stars",
                                       description: Text("חוקים מסווגים תנועות אוטומטית: לפי בית עסק, סכום, תיאור או חשבון"))
            }
        }
        .navigationTitle("חוקים")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showEditor = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showEditor) {
            NavigationStack { RuleEditorView() }
        }
    }

    private func summary(_ rule: Rule) -> String {
        var conditions: [String] = []
        if let m = rule.merchantContains { conditions.append("בית עסק מכיל \"\(m)\"") }
        if let m = rule.merchantEquals { conditions.append("בית עסק הוא \"\(m)\"") }
        if let d = rule.descriptionContains { conditions.append("תיאור מכיל \"\(d)\"") }
        if let minA = rule.amountMin { conditions.append("מעל \(Formatters.currency(minA))") }
        if let maxA = rule.amountMax { conditions.append("עד \(Formatters.currency(maxA))") }

        var actions: [String] = []
        if let catUUID = rule.setCategoryUUID,
           let cat = categories.first(where: { $0.uuid == catUUID }) {
            actions.append("קטגוריה → \(cat.name)")
        }
        if let rename = rule.renameTo { actions.append("שם → \(rename)") }
        if !rule.addTags.isEmpty { actions.append("תגיות: \(rule.addTags.joined(separator: ", "))") }
        if rule.hide { actions.append("הסתרה") }
        if rule.markTransfer { actions.append("העברה") }
        return "\(conditions.joined(separator: " וגם ")) ⟵ \(actions.joined(separator: ", "))"
    }
}

struct RuleEditorView: View {
    var rule: Rule?
    var prefillMerchant: String?
    var prefillCategoryUUID: UUID?

    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Query private var accounts: [Account]
    @Query(sort: \Txn.date, order: .reverse) private var txns: [Txn]
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var merchantContains = ""
    @State private var descriptionContains = ""
    @State private var amountMinText = ""
    @State private var amountMaxText = ""
    @State private var accountUUID: UUID?
    @State private var setCategoryUUID: UUID?
    @State private var renameTo = ""
    @State private var tagsText = ""
    @State private var hide = false
    @State private var markTransfer = false
    @State private var skipReview = false
    @State private var isEnabled = true
    @State private var applyToExisting = true

    var body: some View {
        Form {
            Section("שם החוק") {
                TextField("למשל: וולט → אוכל בחוץ", text: $name)
                Toggle("פעיל", isOn: $isEnabled)
            }

            Section("תנאים (כולם חייבים להתקיים)") {
                TextField("בית עסק מכיל...", text: $merchantContains)
                TextField("תיאור/הערה מכיל...", text: $descriptionContains)
                HStack {
                    TextField("סכום מינימלי", text: $amountMinText).keyboardType(.decimalPad)
                    TextField("סכום מקסימלי", text: $amountMaxText).keyboardType(.decimalPad)
                }
                Picker("חשבון", selection: $accountUUID) {
                    Text("כל חשבון").tag(UUID?.none)
                    ForEach(accounts, id: \.uuid) { acc in
                        Text(acc.name).tag(UUID?.some(acc.uuid))
                    }
                }
            }

            Section("פעולות") {
                Picker("קבע קטגוריה", selection: $setCategoryUUID) {
                    Text("ללא").tag(UUID?.none)
                    ForEach(categories.filter { !$0.isArchived }, id: \.uuid) { cat in
                        Text("\(cat.emoji) \(cat.name)").tag(UUID?.some(cat.uuid))
                    }
                }
                TextField("שנה שם תצוגה ל...", text: $renameTo)
                TextField("הוסף תגיות (מופרדות בפסיק)", text: $tagsText)
                Toggle("הסתר מהתקציב", isOn: $hide)
                Toggle("סמן כהעברה", isOn: $markTransfer)
                Toggle("דלג על בדיקה", isOn: $skipReview)
            }

            Section {
                Toggle("החל על תנועות קיימות", isOn: $applyToExisting)
            }
        }
        .navigationTitle(rule == nil ? "חוק חדש" : "עריכת חוק")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("ביטול") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("שמור") { save() }
                    .disabled(merchantContains.isEmpty && descriptionContains.isEmpty
                              && amountMinText.isEmpty && amountMaxText.isEmpty)
            }
        }
        .onAppear { load() }
    }

    private func load() {
        if let rule {
            name = rule.name
            merchantContains = rule.merchantContains ?? ""
            descriptionContains = rule.descriptionContains ?? ""
            amountMinText = rule.amountMin.map { "\($0)" } ?? ""
            amountMaxText = rule.amountMax.map { "\($0)" } ?? ""
            accountUUID = rule.accountUUID
            setCategoryUUID = rule.setCategoryUUID
            renameTo = rule.renameTo ?? ""
            tagsText = rule.addTags.joined(separator: ", ")
            hide = rule.hide
            markTransfer = rule.markTransfer
            skipReview = rule.skipReview
            isEnabled = rule.isEnabled
        } else {
            merchantContains = prefillMerchant ?? ""
            setCategoryUUID = prefillCategoryUUID
            if let m = prefillMerchant { name = "חוק עבור \(m)" }
        }
    }

    private func save() {
        let target = rule ?? Rule(name: name)
        target.name = name.isEmpty ? merchantContains : name
        target.merchantContains = merchantContains.isEmpty ? nil : merchantContains
        target.descriptionContains = descriptionContains.isEmpty ? nil : descriptionContains
        target.amountMin = Decimal(string: amountMinText, locale: Locale(identifier: "en_US_POSIX"))
        target.amountMax = Decimal(string: amountMaxText, locale: Locale(identifier: "en_US_POSIX"))
        target.accountUUID = accountUUID
        target.setCategoryUUID = setCategoryUUID
        target.renameTo = renameTo.isEmpty ? nil : renameTo
        target.addTags = tagsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        target.hide = hide
        target.markTransfer = markTransfer
        target.skipReview = skipReview
        target.isEnabled = isEnabled
        if rule == nil { context.insert(target) }

        if applyToExisting {
            applyRetroactively(target)
        }
        try? context.save()
        dismiss()
    }

    /// החלה רטרואקטיבית של החוק על כל התנועות הקיימות.
    private func applyRetroactively(_ rule: Rule) {
        let spec = rule.spec
        for txn in txns {
            let facts = TxnFacts(rawMerchant: txn.rawMerchant,
                                 displayName: txn.displayName,
                                 notes: txn.notes,
                                 amount: txn.amount,
                                 accountUUID: txn.account?.uuid)
            guard RulesEngine.matches(spec, facts: facts) else { continue }
            if let catUUID = rule.setCategoryUUID {
                txn.category = categories.first { $0.uuid == catUUID }
            }
            if let rename = rule.renameTo { txn.displayName = rename }
            for tag in rule.addTags where !txn.tags.contains(tag) { txn.tags.append(tag) }
            if rule.hide { txn.isHidden = true }
            if rule.markTransfer { txn.isTransfer = true }
            if rule.skipReview { txn.status = .reviewed }
        }
    }
}
