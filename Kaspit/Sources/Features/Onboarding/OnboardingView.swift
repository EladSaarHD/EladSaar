import SwiftUI
import SwiftData

struct OnboardingView: View {
    @Environment(\.modelContext) private var context
    @Environment(AppLockManager.self) private var lock
    @AppStorage("didOnboard") private var didOnboard = false

    @State private var step = 0
    @State private var checkingName = "עו\"ש"
    @State private var checkingBalance = ""
    @State private var cardName = "כרטיס אשראי"
    @State private var billingDay = 10
    @State private var addCard = true
    @State private var enableFaceID = true
    @State private var enableNotifications = true

    var body: some View {
        VStack {
            TabView(selection: $step) {
                welcome.tag(0)
                accountsStep.tag(1)
                securityStep.tag(2)
            }
            .tabViewStyle(.page)

            Button {
                if step < 2 { step += 1 } else { finish() }
            } label: {
                Text(step < 2 ? "המשך" : "בוא נתחיל")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .padding()
        }
    }

    private var welcome: some View {
        VStack(spacing: 16) {
            Text("💰").font(.system(size: 72))
            Text("ברוכים הבאים לכספית").font(.largeTitle.bold())
            Text("כל הכסף שלך במקום אחד: תנועות, תקציב, מנויים, השקעות ושווי נקי.\nהכול בעברית, הכול על המכשיר שלך.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 32)
        }
    }

    private var accountsStep: some View {
        Form {
            Section("חשבון עו\"ש") {
                TextField("שם", text: $checkingName)
                TextField("יתרה נוכחית בש\"ח", text: $checkingBalance)
                    .keyboardType(.numbersAndPunctuation)
            }
            Section {
                Toggle("יש לי כרטיס אשראי", isOn: $addCard)
                if addCard {
                    TextField("שם הכרטיס", text: $cardName)
                    Picker("מועד חיוב חודשי", selection: $billingDay) {
                        ForEach([1, 2, 10, 15, 25], id: \.self) { Text("\($0) בחודש").tag($0) }
                    }
                }
            } footer: {
                Text("אפשר להוסיף עוד חשבונות, הלוואות, פנסיה וקרן השתלמות אחר כך — במסך החשבונות.")
            }
        }
        .scrollContentBackground(.hidden)
    }

    private var securityStep: some View {
        Form {
            Section("אבטחה") {
                Toggle("נעילה עם Face ID", isOn: $enableFaceID)
            }
            Section("התראות") {
                Toggle("התראות חכמות", isOn: $enableNotifications)
            } footer: {
                Text("חיוב שעומד לרדת, חריגה מתקציב, עליית מחיר במנוי וסיכום שבועי. אפשר לכוונן הכול בהגדרות.")
            }
        }
        .scrollContentBackground(.hidden)
    }

    private func finish() {
        let posix = Locale(identifier: "en_US_POSIX")
        let checking = Account(name: checkingName, kind: .checking)
        checking.recordBalanceSnapshot(
            Decimal(string: checkingBalance.replacingOccurrences(of: ",", with: ""), locale: posix) ?? 0)
        context.insert(checking)

        if addCard {
            context.insert(Account(name: cardName, kind: .creditCard, billingDay: billingDay))
        }
        try? context.save()

        lock.isEnabled = enableFaceID
        if enableNotifications {
            Task {
                _ = await NotificationService.shared.requestAuthorization()
                NotificationService.shared.scheduleWeeklySummary()
            }
        }
        didOnboard = true
    }
}
