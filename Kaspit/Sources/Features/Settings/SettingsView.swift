import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(AppLockManager.self) private var lock
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Txn.date) private var txns: [Txn]
    @AppStorage("useChargeDate") private var useChargeDate = false
    @State private var exportURL: URL?

    var body: some View {
        NavigationStack {
            Form {
                Section("ניהול") {
                    NavigationLink("קטגוריות") { CategoriesEditorView() }
                    NavigationLink("חוקים") { RulesListView() }
                    NavigationLink("התראות") { NotificationSettingsView() }
                }

                Section("תצוגה") {
                    Toggle("תקציב לפי מועד חיוב אשראי", isOn: $useChargeDate)
                } footer: {
                    Text("כשמופעל, תנועות כרטיס אשראי משויכות לחודש שבו הן מחויבות בפועל בעו\"ש.")
                }

                Section("אבטחה") {
                    Toggle("נעילה עם Face ID", isOn: Binding(
                        get: { lock.isEnabled },
                        set: { lock.isEnabled = $0 }))
                } footer: {
                    Text("כל הנתונים נשמרים על המכשיר בלבד. סנכרון iCloud מוצפן — בקרוב.")
                }

                Section("נתונים") {
                    if let url = exportURL {
                        ShareLink(item: url) {
                            Label("שתף את קובץ הייצוא", systemImage: "square.and.arrow.up")
                        }
                    } else {
                        Button {
                            exportURL = exportCSV()
                        } label: {
                            Label("ייצא תנועות ל-CSV", systemImage: "tablecells")
                        }
                    }
                }

                Section("אודות") {
                    LabeledContent("גרסה", value: "0.1 (MVP)")
                    Text("כספית — ניהול כספים אישי לשוק הישראלי. בהשראת Copilot Money.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("הגדרות")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("סגור") { dismiss() } }
            }
        }
    }

    private func exportCSV() -> URL? {
        var csv = "date,charge_date,merchant,display_name,amount,currency,category,account,tags,notes,hidden,transfer\n"
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        for txn in txns {
            func esc(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
            let fields = [
                f.string(from: txn.date),
                txn.chargeDate.map { f.string(from: $0) } ?? "",
                esc(txn.rawMerchant),
                esc(txn.displayName),
                "\(txn.amount)",
                txn.currencyCode,
                esc(txn.category?.name ?? ""),
                esc(txn.account?.name ?? ""),
                esc(txn.tags.joined(separator: ";")),
                esc(txn.notes),
                txn.isHidden ? "1" : "0",
                txn.isTransfer ? "1" : "0",
            ]
            csv += fields.joined(separator: ",") + "\n"
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("kaspit-export.csv")
        do {
            try csv.write(to: url, atomically: true, encoding: .utf8)
            return url
        } catch {
            return nil
        }
    }
}

struct CategoriesEditorView: View {
    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Environment(\.modelContext) private var context
    @State private var showAdd = false

    var body: some View {
        List {
            ForEach(CategoryKind.allCases) { kind in
                Section(kind.label) {
                    ForEach(categories.filter { $0.kind == kind && !$0.isArchived }, id: \.uuid) { cat in
                        NavigationLink {
                            CategoryEditorView(category: cat)
                        } label: {
                            HStack {
                                Text(cat.emoji)
                                Text(cat.name)
                                Spacer()
                                if !cat.group.isEmpty {
                                    Text(cat.group).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("קטגוריות")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showAdd = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showAdd) {
            NavigationStack { CategoryEditorView() }
        }
    }
}

struct CategoryEditorView: View {
    var category: Category?
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var emoji = "🏷️"
    @State private var group = ""
    @State private var kind: CategoryKind = .expense

    var body: some View {
        Form {
            TextField("שם", text: $name)
            TextField("אימוג'י", text: $emoji)
            TextField("קבוצה (בית, רכב...)", text: $group)
            Picker("סוג", selection: $kind) {
                ForEach(CategoryKind.allCases) { Text($0.label).tag($0) }
            }
            if let category {
                Button("העבר לארכיון", role: .destructive) {
                    category.isArchived = true
                    try? context.save()
                    dismiss()
                }
            }
        }
        .navigationTitle(category == nil ? "קטגוריה חדשה" : "עריכת קטגוריה")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("שמור") { save() }.disabled(name.isEmpty)
            }
        }
        .onAppear {
            if let category {
                name = category.name; emoji = category.emoji
                group = category.group; kind = category.kind
            }
        }
    }

    private func save() {
        if let category {
            category.name = name; category.emoji = emoji
            category.group = group; category.kind = kind
        } else {
            context.insert(Category(name: name, emoji: emoji, group: group, kind: kind, sortOrder: 999))
        }
        try? context.save()
        dismiss()
    }
}

struct NotificationSettingsView: View {
    @State private var toggles: [NotificationKind: Bool] = [:]

    var body: some View {
        Form {
            Section {
                ForEach(NotificationKind.allCases) { kind in
                    Toggle(kind.label, isOn: Binding(
                        get: { toggles[kind] ?? NotificationService.shared.isEnabled(kind) },
                        set: { on in
                            toggles[kind] = on
                            NotificationService.shared.setEnabled(kind, on)
                            if kind == .weeklySummary && on {
                                NotificationService.shared.scheduleWeeklySummary()
                            }
                        }))
                }
            } footer: {
                Text("רואים רק את ההתראות שחשובות לך — כבה את מה שלא.")
            }
        }
        .navigationTitle("התראות")
    }
}
