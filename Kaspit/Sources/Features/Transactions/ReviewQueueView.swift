import SwiftUI
import SwiftData

/// זרימת הבדיקה של Copilot: תנועה-תנועה, אישור מהיר או תיקון קטגוריה.
struct ReviewQueueView: View {
    @Query(sort: \Txn.date, order: .reverse) private var txns: [Txn]
    @Query(sort: \Category.sortOrder) private var categories: [Category]
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    private var queue: [Txn] { txns.filter { $0.status == .needsReview && !$0.isHidden } }

    var body: some View {
        NavigationStack {
            Group {
                if let txn = queue.first {
                    reviewCard(txn)
                } else {
                    ContentUnavailableView("סיימת! 🎉",
                                           systemImage: "checkmark.seal.fill",
                                           description: Text("כל התנועות נבדקו"))
                }
            }
            .navigationTitle("לבדיקה (\(queue.count))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("סגור") { dismiss() }
                }
                ToolbarItem(placement: .topBarLeading) {
                    if !queue.isEmpty {
                        Button("אשר הכול") {
                            for txn in queue { txn.status = .reviewed }
                            try? context.save()
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func reviewCard(_ txn: Txn) -> some View {
        VStack(spacing: 20) {
            Spacer()
            EmojiBadge(emoji: txn.category?.emoji ?? "❓", size: 72)
            Text(txn.displayName).font(.title2.bold())
            AmountText(amount: txn.amount).font(.system(size: 40, weight: .bold, design: .rounded))
            VStack(spacing: 4) {
                Text(Formatters.dayLabel(txn.date))
                if let account = txn.account { Text(account.name) }
                if let inst = txn.installmentLabel { Text(inst) }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            if let cat = txn.category {
                Text("הצעה: \(cat.emoji) \(cat.name)")
                    .padding(.horizontal, 14).padding(.vertical, 6)
                    .background(Color(.tertiarySystemFill), in: Capsule())
            }

            // תיקון מהיר — בחירת קטגוריה אחרת מלמדת את המנוע
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(categories.filter { !$0.isArchived && $0.kind == (txn.amount < 0 ? .expense : .income) }, id: \.uuid) { cat in
                        Button {
                            txn.category = cat
                            approve(txn)
                        } label: {
                            Text("\(cat.emoji) \(cat.name)")
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(Color(.secondarySystemFill), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }

            Spacer()

            HStack(spacing: 16) {
                Button {
                    txn.isHidden = true
                    approve(txn)
                } label: {
                    Label("הסתר", systemImage: "eye.slash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Button {
                    approve(txn)
                } label: {
                    Label("אשר", systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(txn.category == nil)
            }
            .padding()
        }
    }

    private func approve(_ txn: Txn) {
        txn.status = .reviewed
        try? context.save()
    }
}
