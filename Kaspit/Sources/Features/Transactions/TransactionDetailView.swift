import SwiftUI
import SwiftData

struct TransactionDetailView: View {
    @Bindable var txn: Txn
    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Query private var goals: [Goal]
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var newTag = ""
    @State private var showSplitEditor = false
    @State private var showRuleEditor = false

    var body: some View {
        Form {
            Section {
                HStack {
                    EmojiBadge(emoji: txn.category?.emoji ?? "❓", size: 44)
                    VStack(alignment: .leading) {
                        TextField("שם תצוגה", text: $txn.displayName)
                            .font(.headline)
                        if txn.rawMerchant != txn.displayName {
                            Text(txn.rawMerchant)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    AmountText(amount: txn.amount).font(.title3.bold())
                }
                LabeledContent("תאריך עסקה", value: Formatters.shortDate(txn.date))
                if let charge = txn.chargeDate {
                    LabeledContent("מועד חיוב", value: Formatters.shortDate(charge))
                }
                if let inst = txn.installmentLabel {
                    LabeledContent("תשלומים", value: inst)
                }
                if let account = txn.account {
                    LabeledContent("חשבון", value: account.name)
                }
            }

            Section("קטגוריה") {
                Picker("קטגוריה", selection: categoryBinding) {
                    Text("ללא").tag(UUID?.none)
                    ForEach(categories.filter { !$0.isArchived }, id: \.uuid) { cat in
                        Text("\(cat.emoji) \(cat.name)").tag(UUID?.some(cat.uuid))
                    }
                }
                if txn.splits.isEmpty {
                    Button("פצל בין קטגוריות") { showSplitEditor = true }
                } else {
                    ForEach(txn.splits) { split in
                        HStack {
                            Text(categories.first { $0.uuid == split.categoryUUID }
                                .map { "\($0.emoji) \($0.name)" } ?? "?")
                            Spacer()
                            Text(Formatters.currency(split.amount.abs)).monospacedDigit()
                        }
                    }
                    Button("ערוך פיצול") { showSplitEditor = true }
                }
            }

            Section("תגיות והערות") {
                if !txn.tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(txn.tags, id: \.self) { tag in
                                Text("#\(tag)")
                                    .padding(.horizontal, 10).padding(.vertical, 4)
                                    .background(Color(.tertiarySystemFill), in: Capsule())
                                    .onTapGesture { txn.tags.removeAll { $0 == tag } }
                            }
                        }
                    }
                }
                HStack {
                    TextField("תגית חדשה", text: $newTag)
                    Button("הוסף") {
                        let tag = newTag.trimmingCharacters(in: .whitespaces)
                        if !tag.isEmpty && !txn.tags.contains(tag) { txn.tags.append(tag) }
                        newTag = ""
                    }
                    .disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                TextField("הערות", text: $txn.notes, axis: .vertical)
            }

            Section("יעד חיסכון") {
                Picker("נספרת ליעד", selection: $txn.goalUUID) {
                    Text("ללא").tag(UUID?.none)
                    ForEach(goals, id: \.uuid) { goal in
                        Text("\(goal.emoji) \(goal.name)").tag(UUID?.some(goal.uuid))
                    }
                }
            }

            Section {
                Toggle("הסתר מהתקציב", isOn: $txn.isHidden)
                Toggle("העברה פנימית", isOn: $txn.isTransfer)
                Button("צור חוק מתנועה זו") { showRuleEditor = true }
            }

            if txn.status == .needsReview {
                Section {
                    Button {
                        txn.status = .reviewed
                        try? context.save()
                        dismiss()
                    } label: {
                        Label("אשר תנועה", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowBackground(Color.clear)
                }
            }

            Section {
                Button("מחק תנועה", role: .destructive) {
                    context.delete(txn)
                    try? context.save()
                    dismiss()
                }
            }
        }
        .navigationTitle("פרטי תנועה")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showSplitEditor) { SplitEditorView(txn: txn) }
        .sheet(isPresented: $showRuleEditor) {
            NavigationStack {
                RuleEditorView(prefillMerchant: txn.displayName, prefillCategoryUUID: txn.category?.uuid)
            }
        }
        .onDisappear { try? context.save() }
    }

    private var categoryBinding: Binding<UUID?> {
        Binding(get: { txn.category?.uuid },
                set: { newValue in
                    txn.category = categories.first { $0.uuid == newValue }
                    // בחירת קטגוריה ידנית = אישור; מכאן המנוע לומד.
                    if newValue != nil { txn.status = .reviewed }
                })
    }
}

/// עורך פיצול תנועה בין קטגוריות.
struct SplitEditorView: View {
    @Bindable var txn: Txn
    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Environment(\.dismiss) private var dismiss
    @State private var splits: [TxnSplit] = []

    private var total: Decimal { txn.amount.abs }
    private var allocated: Decimal { splits.reduce(0) { $0 + $1.amount.abs } }

    var body: some View {
        NavigationStack {
            Form {
                ForEach($splits) { $split in
                    HStack {
                        Picker("", selection: $split.categoryUUID) {
                            ForEach(categories.filter { !$0.isArchived }, id: \.uuid) { cat in
                                Text("\(cat.emoji) \(cat.name)").tag(cat.uuid)
                            }
                        }
                        .labelsHidden()
                        TextField("סכום", value: $split.amount, format: .number)
                            .keyboardType(.decimalPad)
                            .frame(width: 90)
                            .multilineTextAlignment(.trailing)
                    }
                }
                .onDelete { splits.remove(atOffsets: $0) }

                Button("הוסף חלק") {
                    if let first = categories.first {
                        splits.append(TxnSplit(categoryUUID: first.uuid, amount: total - allocated))
                    }
                }

                LabeledContent("סה\"כ לחלוקה", value: Formatters.currency(total))
                LabeledContent("חולק", value: Formatters.currency(allocated))
                    .foregroundStyle(allocated == total ? Theme.income : Theme.warning)
            }
            .navigationTitle("פיצול תנועה")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ביטול") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("שמור") {
                        txn.splits = splits.filter { $0.amount != 0 }
                        dismiss()
                    }
                    .disabled(!splits.isEmpty && allocated != total)
                }
            }
            .onAppear { splits = txn.splits }
        }
    }
}
