# Accessibility Lessons

A11y patterns discovered while building interactive components. Dated entries; newest practices win when guidance conflicts.

## 2025-10-18 - Keyboard Accessible Cards

**Learning:** Custom interactive elements like cards need explicit keyboard handling (tabindex, role, keydown). Simply adding `click` listeners excludes keyboard-only users.
**Action:** Always pair `click` listeners on non-button elements with `keydown` (Enter/Space) and proper ARIA attributes (`role="button"`, `tabindex="0"`).

## 2025-10-18 - Stretched Link Pattern for Cards

**Learning:** Nesting interactive elements (like a favorite button) inside a clickable card (`role="button"`) violates ARIA standards.
**Action:** Use the "Stretched Link" pattern: place a primary anchor tag inside the card, stretch it with CSS (`::after { inset: 0 }`), and ensure secondary actions (favorite button) have a higher z-index (`z-index: 2`). This provides native link behavior (Open in New Tab) and better accessibility.
