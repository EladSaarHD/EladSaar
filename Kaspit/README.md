# כספית (Kaspit)

Copilot Money–style personal finance app for the Israeli market. SwiftUI, SwiftData, iOS 17+, fully Hebrew and RTL. Product plan: [`/docs/copilot-clone/PLAN.he.md`](../docs/copilot-clone/PLAN.he.md).

## Building

Requires Xcode 15+ on macOS. The project file is generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
brew install xcodegen
cd Kaspit
xcodegen generate
open Kaspit.xcodeproj
```

Alternatively, create a new iOS App project in Xcode (iOS 17, SwiftUI, Hebrew as development language) and drag the `Sources/` folder in, plus `Tests/` as a unit-test target.

## Feature map

| Copilot Money | Kaspit |
|---|---|
| Dashboard (to-review, budget trends, upcoming, net income, net worth) | `Features/Dashboard` |
| Transactions + review workflow + splits + tags + hide | `Features/Transactions` |
| Learning categorization | `Services/CategorizationEngine`, `Services/MerchantNormalizer` |
| Budgets with rollover & rebalance | `Features/Budget` |
| Recurrings / subscriptions + price-increase detection | `Services/RecurringDetector`, `Features/Recurrings` |
| Accounts / investments / net worth | `Features/Accounts`, `Services/QuotesService` |
| Cash flow | `Features/Dashboard/CashFlowView` |
| Goals | `Features/Goals` |
| Rules engine | `Services/RulesEngine`, `Features/Rules` |
| Bank connections (Plaid) | Israeli CSV/Excel import wizard (`Features/Import`, `Services/CSVImport`) — see plan §5 for the sync roadmap |
| Notifications | `Services/NotificationService` |
| Face ID lock | `Support/AppLockManager` |

Israeli specifics: credit-card billing cycles (מועד חיוב), installments (תשלומים), Bit/Paybox transfer detection, merchant-name normalization for Hebrew card-company strings, pension/קרן השתלמות account types, ₪ formatting with `he_IL`.

## Tests

`KaspitTests` covers the pure-logic services (categorization, rules, recurring detection, transfer matching, CSV parsing) with Israeli bank fixture data. Run with ⌘U in Xcode.
