# Security Lessons

Vulnerabilities found and the patterns we adopted to prevent them.

> **When to add an entry:** after fixing a vulnerability whose root cause was a pattern (not a single-site mistake). Date it (`YYYY-MM-DD`), state the Vulnerability + Learning + Prevention in 2–5 lines, and add the newest entry at the top. Newest entries win when guidance conflicts. If a pattern fits inside an architecture doc, put the canonical version there and add a short pointer here.

## 2025-10-18 - DOM XSS in Recipe Component

**Vulnerability:** Found `innerHTML` being used to render recipe ingredients (`unit`, `item`) without sanitization in `RecipeComponent`. This allowed potential XSS if a user submitted malicious HTML in ingredient fields.
**Learning:** Checking that input is a "string" (type validation) is not sufficient for security. Data stored in Firestore should not be trusted implicitly when rendering to DOM.
**Prevention:** Prefer `textContent` or `document.createTextNode` over `innerHTML` for text content. If `innerHTML` is required for rich text, use a sanitization library like DOMPurify.
