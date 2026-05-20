# My Cook Book 🍳

A Hebrew recipe sharing application built to preserve and share family culinary traditions.

> **Project Context:**
> This project represents my **first deep dive into full-stack web development**.
> It was built with a deliberate educational goal: to master the fundamentals of web development (DOM manipulation, state management, routing) by building them from scratch using **Vanilla JavaScript** and **Web Components**, rather than relying on frameworks like React or Angular from the start.

---

## 📖 About The Project

My Cook Book is a Progressive Web Application (PWA) that allows users to browse, search, and contribute family recipes. It features a robust role-based system where authorized users can propose new recipes, and managers can review and approve them.

The application is built as a Single Page Application (SPA) using a custom-built History API router and leverages the Firebase ecosystem for a serverless backend experience.

## ✨ Key Features

- **Recipe Collection:** Browse and search a rich collection of family recipes with support for Hebrew text (RTL).
- **User Authentication:** Secure login and signup (Email/Password & Google OAuth) powered by **Firebase Auth**.
- **Role-Based Access:**
  - **Viewers:** Can browse and search recipes.
  - **Contributors:** Can propose new recipes and upload images.
  - **Managers:** dedicated dashboard to review, approve, or edit pending recipes.
- **Responsive Design:** A mobile-first interface that looks great on all devices.
- **Custom Router:** A lightweight client-side router built from scratch on the History API.

## 🛠 Tech Stack & Architecture

This project was built to demonstrate a strong grasp of core web technologies:

- **Frontend:**
  - **Vanilla JavaScript (ES6+):** Core logic and state management.
  - **Web Components:** Encapsulated UI components using Shadow DOM for style isolation.
  - **Custom SPA Router:** Handles navigation and dynamic view rendering without page reloads.
  - **CSS3:** Custom styling with a focus on responsiveness.
  - **Vite:** Modern build tool for fast development and optimized production assets.

- **Backend (Firebase):**
  - **Cloud Firestore:** NoSQL database for real-time data syncing.
  - **Firebase Authentication:** Secure user identity management.
  - **Cloud Storage:** Scalable storage for user-uploaded recipe images.

- **Testing:**
  - **Jest:** Unit testing for core utilities and services.
  - **Playwright:** End-to-end and visual regression tests.

## 📚 Documentation

- [`CLAUDE.md`](./CLAUDE.md) — developer & agent guide: commands, conventions, repo conventions.
- [`docs/architecture/`](./docs/architecture/) — deeper references for the [SPA core](./docs/architecture/spa-core.md), [component system](./docs/architecture/components.md), [services / Firebase layer](./docs/architecture/services.md), and [design system](./docs/architecture/design-system.md).
- [`docs/lessons/`](./docs/lessons/) — patterns and pitfalls discovered while building: [performance](./docs/lessons/performance.md), [accessibility](./docs/lessons/accessibility.md), [security](./docs/lessons/security.md).
- [`docs/operations/firebase-image-optimization.md`](./docs/operations/firebase-image-optimization.md) — image pipeline configuration and bulk-reprocessing notes.
- [`CHANGELOG.md`](./CHANGELOG.md) — versioned change log.

## 🚀 Live Demo

You can view the live application hosted on Netlify here:
[**https://our-kitchen-chronicles.netlify.app/**](https://our-kitchen-chronicles.netlify.app/)

## 🔮 Future Plans

While this project was a foundational learning experience, I plan to continue evolving it:

- **Social Features:** Adding comments, ratings, and social sharing capabilities.
- **Offline Support:** Enhancing PWA capabilities for fully offline access to saved recipes.

---

_Built by [Roi Guri](https://github.com/roiguri)_
