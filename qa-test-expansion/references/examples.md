# QA Test Expansion Examples

### Example 1: Boundary Violation (Negative Withdrawal)

**User Input:**
```js
// A simple banking function
class BankAccount {
    constructor(balance) { this.balance = balance; }
    withdraw(amount) {
        if (this.balance >= amount) {
            this.balance -= amount;
            return true;
        }
        return false;
    }
}
```

**Skill Response:**

#### 1. Vulnerability & Impact Analysis
- **The Flaw:** Missing lower-bound validation on the amount parameter.
- **Why it Matters:** Critical financial vulnerability. A malicious actor can pass a negative withdrawal amount, which mathematically adds to the balance, allowing users to mint infinite money.

#### 2. Execution Trace (Proof of Concept)
- **Input:** `account = new BankAccount(100); account.withdraw(-500);`
- **Expected State:** The withdrawal fails, balance remains 100.
- **Actual State:** `100 >= -500` evaluates to true. `100 - (-500)` makes the balance 600.

#### 3. The Failing Test (Red)
```js
const assert = require('assert');
describe('BankAccount', () => {
  it('should reject negative withdrawals', () => {
    const account = new BankAccount(100);
    const result = account.withdraw(-50);
    assert.strictEqual(result, false, 'Negative amounts should return false');
    assert.strictEqual(account.balance, 100, 'Balance should not increase');
  });
});
```
This test will currently FAIL because the code returns `true` and the balance becomes `150`.

#### 4. The Minimal Fix
```js
class BankAccount {
  constructor(balance) { this.balance = balance; }
  withdraw(amount) {
    // FIXED: Added check for negative or zero amounts
    if (amount <= 0) return false;
    if (this.balance >= amount) {
      this.balance -= amount;
      return true;
    }
    return false;
  }
}
```

#### 5. Verification (Green)
With the patched code, when `account.withdraw(-50)` is called, the new condition `if (amount <= 0)` catches the `-50`. The function immediately returns `false` before any subtraction occurs. The assertions for both the return value and the unchanged balance now PASS.

---

### Example 2: State Leak (Shared Mutable Reference)

**User Input:**
```js
// A simple config accessor
const DEFAULTS = { retries: 3, timeoutMs: 1000 };
function getDefaults() {
  // BUG: returns a shared mutable object
  return DEFAULTS;
}
module.exports = { getDefaults };
```

**Skill Response:**

#### 1. Vulnerability & Impact Analysis
- **The Flaw:** `getDefaults()` returns a shared mutable reference. Any caller can mutate global defaults for all future callers.
- **Why it Matters:** State leaks can cause non-deterministic behavior, production incidents, and security issues (e.g., callers disabling timeouts/retries, weakening resilience and potentially enabling resource exhaustion).

#### 2. Execution Trace (Proof of Concept)
- **Location:** `src/config.js` → `getDefaults()`
- **Input (payload):**
```text
const a = getDefaults();
a.timeoutMs = 0;
const b = getDefaults();
```
- **Expected State:** Mutating `a` should NOT affect `b` (each caller should get an isolated copy).
- **Actual State (current code):** `a` and `b` are the same object. Setting `a.timeoutMs = 0` also sets `b.timeoutMs = 0`.

#### 3. The Failing Test (Red)
```js
const assert = require('assert');
const { getDefaults } = require('./config');
describe('getDefaults', () => {
  it('should not allow callers to mutate global defaults (state leak)', () => {
    const a = getDefaults();
    a.timeoutMs = 0;
    const b = getDefaults();
    assert.strictEqual(b.timeoutMs, 1000, 'Defaults must remain unchanged for other callers');
  });
});
```
This test will currently FAIL because `getDefaults()` returns the same object each time, so the mutation leaks into subsequent calls.

#### 4. The Minimal Fix
```js
const DEFAULTS = { retries: 3, timeoutMs: 1000 };
function getDefaults() {
  // FIXED: return a defensive copy to prevent shared-state mutation
  return { ...DEFAULTS };
}
module.exports = { getDefaults };
```

#### 5. Verification (Green)
With the patched code, `getDefaults()` returns a fresh object on each call. Mutating `a.timeoutMs` no longer changes the underlying `DEFAULTS`, so `b.timeoutMs` remains `1000` and the assertions now PASS.
