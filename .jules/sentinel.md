## 2026-03-01 - Redaction Regex Partial Leakage
**Vulnerability:** Updating a regex to strictly match a shorter length (e.g. `/npm_[a-zA-Z0-9]{32}/gi`) when longer legacy lengths exist (`36-40`) causes partial redaction, leaking the trailing characters into plaintext logs.
**Learning:** Redaction patterns must always use length ranges or unbounded ends to cover all valid variations, rather than enforcing strict exact lengths that might partially match and leak.
**Prevention:** Ensure test cases explicitly verify that standard and legacy lengths are completely redacted without partial matches, and utilize length ranges like `{32,40}` in redaction regex definitions.
