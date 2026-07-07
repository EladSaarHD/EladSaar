import Foundation

/// חישובי תקציב ותזרים על אוסף תנועות. מרוכזים כאן לשימוש הדשבורד, התקציב והתזרים.
enum BudgetMath {

    /// תנועות ששייכות לחודש נתון (קלנדרי או מחזור חיוב) ונספרות בתקציב.
    static func txns(_ all: [Txn], inMonth monthKey: String, useChargeDate: Bool) -> [Txn] {
        guard let range = MonthKey.range(for: monthKey) else { return [] }
        return all.filter { txn in
            txn.countsInBudget && range.contains(txn.budgetDate(usingChargeDate: useChargeDate))
        }
    }

    /// הוצאה לכל קטגוריה בחודש (ערכים חיוביים). פיצולים נספרים לפי הקטגוריה של כל חלק.
    static func spentByCategory(_ all: [Txn], monthKey: String, useChargeDate: Bool) -> [UUID: Decimal] {
        var result: [UUID: Decimal] = [:]
        for txn in txns(all, inMonth: monthKey, useChargeDate: useChargeDate) where txn.amount < 0 {
            if !txn.splits.isEmpty {
                for split in txn.splits {
                    result[split.categoryUUID, default: 0] += split.amount.abs
                }
            } else if let cat = txn.category {
                result[cat.uuid, default: 0] += txn.amount.abs
            } else {
                result[UUID(uuidString: "00000000-0000-0000-0000-000000000000")!, default: 0] += txn.amount.abs
            }
        }
        return result
    }

    static func totalExpenses(_ all: [Txn], monthKey: String, useChargeDate: Bool) -> Decimal {
        txns(all, inMonth: monthKey, useChargeDate: useChargeDate)
            .filter { $0.amount < 0 }
            .reduce(Decimal(0)) { $0 + $1.amount.abs }
    }

    static func totalIncome(_ all: [Txn], monthKey: String, useChargeDate: Bool) -> Decimal {
        txns(all, inMonth: monthKey, useChargeDate: useChargeDate)
            .filter { $0.amount > 0 }
            .reduce(Decimal(0)) { $0 + $1.amount }
    }

    /// גלגול יתרה מצטבר: עודף/חוסר מחודשים קודמים (עד 12 אחורה) לקטגוריות עם rollover.
    static func rolloverAmount(categoryUUID: UUID,
                               monthKey: String,
                               entries: [BudgetEntry],
                               allTxns: [Txn],
                               useChargeDate: Bool) -> Decimal {
        var carry: Decimal = 0
        var key = monthKey
        var months: [String] = []
        for _ in 0..<12 {
            key = MonthKey.previous(key)
            months.append(key)
        }
        for month in months.reversed() {
            guard let entry = entries.first(where: { $0.monthKey == month && $0.category?.uuid == categoryUUID }),
                  entry.rollover else {
                carry = 0
                continue
            }
            let spent = spentByCategory(allTxns, monthKey: month, useChargeDate: useChargeDate)[categoryUUID] ?? 0
            carry = entry.amount + carry - spent
        }
        return carry
    }

    /// סיכום חודשי לתזרים: (מפתח חודש, הכנסות, הוצאות).
    static func monthlyCashFlow(_ all: [Txn], monthsBack: Int, from now: Date = Date(), useChargeDate: Bool) -> [(monthKey: String, income: Decimal, expenses: Decimal)] {
        var result: [(monthKey: String, income: Decimal, expenses: Decimal)] = []
        var key = MonthKey.key(for: now)
        for _ in 0..<monthsBack {
            let income = totalIncome(all, monthKey: key, useChargeDate: useChargeDate)
            let expenses = totalExpenses(all, monthKey: key, useChargeDate: useChargeDate)
            result.append((monthKey: key, income: income, expenses: expenses))
            key = MonthKey.previous(key)
        }
        return result.reversed()
    }
}
