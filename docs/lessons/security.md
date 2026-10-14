# Security Lessons

Vulnerabilities found and the patterns we adopted to prevent them.

> **When to add an entry:** after fixing a vulnerability whose root cause was a pattern (not a single-site mistake). Date it (`YYYY-MM-DD`), state the Vulnerability + Learning + Prevention in 2–5 lines, and add the newest entry at the top. Newest entries win when guidance conflicts. If a pattern fits inside an architecture doc, put the canonical version there and add a short pointer here.

## 2026-10-14 - Storage rules: keep Firestore lookups per request to two

**Vulnerability (fail-closed):** the shared-photo rule (recipe sharing, R3) made three `firestore.get()/exists()` calls — share record, recipe, role — on top of the private folder's own manager check. It passed every emulator test, but on the test project recipients were denied (`storage/unauthorized`): production Storage rules cap Firestore lookups per request, and the emulator doesn't enforce the cap.
**Learning:** A Storage rule that reads Firestore can pass the emulator and still fail closed in production when it makes too many lookups.
**Prevention:** Keep a Storage rule to two Firestore lookups. Store what the rule needs on one document the rule already reads (here the share record carries `authorId`, checked against the recipe when the record is created). After a Storage rules deploy, smoke-test the new path as the user it is for on the test project.

## 2026-10-12 - Storage rules that read Firestore need a per-project IAM grant

**Vulnerability (fail-closed):** `storage.rules` uses `firestore.get()/exists()` (manager check, recipe author, published). In production the Storage service agent lacked `roles/firebaserules.firestoreServiceAgent`, so every lookup errored and was denied: managers couldn't overwrite or delete recipe files (AI enhancer save → 403), while plain creates still passed. The test project had the grant from long before, and the emulator doesn't check IAM, so no test could catch it.
**Learning:** Cross-service rules depend on project IAM, not just the rules file. Copying data between projects doesn't copy IAM.
**Prevention:** Before deploying Storage rules to a project, check that `service-‹project-number›@gcp-sa-firebasestorage.iam.gserviceaccount.com` has `roles/firebaserules.firestoreServiceAgent` (`gcloud projects get-iam-policy ‹project›`). Grant it if missing; the Firebase console's "allow cross-service rules" prompt does the same. After a Storage rules deploy, smoke-test one manager overwrite on that project.

## 2025-10-18 - DOM XSS in Recipe Component

**Vulnerability:** Found `innerHTML` being used to render recipe ingredients (`unit`, `item`) without sanitization in `RecipeComponent`. This allowed potential XSS if a user submitted malicious HTML in ingredient fields.
**Learning:** Checking that input is a "string" (type validation) is not sufficient for security. Data stored in Firestore should not be trusted implicitly when rendering to DOM.
**Prevention:** Prefer `textContent` or `document.createTextNode` over `innerHTML` for text content. If `innerHTML` is required for rich text, use a sanitization library like DOMPurify.
