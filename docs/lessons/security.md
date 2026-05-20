# Security Lessons

Vulnerabilities found and the patterns we adopted to prevent them. Dated entries; newest practices win when guidance conflicts.

## 2025-10-18 - DOM XSS in Recipe Component

**Vulnerability:** Found `innerHTML` being used to render recipe ingredients (`unit`, `item`) without sanitization in `RecipeComponent`. This allowed potential XSS if a user submitted malicious HTML in ingredient fields.
**Learning:** Checking that input is a "string" (type validation) is not sufficient for security. Data stored in Firestore should not be trusted implicitly when rendering to DOM.
**Prevention:** Prefer `textContent` or `document.createTextNode` over `innerHTML` for text content. If `innerHTML` is required for rich text, use a sanitization library like DOMPurify.
