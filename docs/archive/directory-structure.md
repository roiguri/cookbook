# Directory Structure - My Cook Book SPA

## Current Architecture: Single Page Application (SPA)

```
My-Cook-Book/
│
├── .vscode/
│   └── settings.json                    # VS Code settings
├── docs/
│   ├── directory-structure.md           # This file
│   ├── feature-plans/                   # Feature planning docs
│   │   └── completed/
│   │       ├── SPA-Phase1.md
│   │       └── Spa-Phase2.md
│   ├── project-tracking.md
│   └── site-plan.md
├── public/                              # Static assets served by Vite
│   ├── img/
│   │   ├── background/
│   │   ├── category-jars/
│   │   └── icon/
│   ├── service-worker.js                # PWA service worker
│   └── site.webmanifest.json           # PWA manifest
├── src/                                 # Source files
│   ├── app.js                          # SPA entry point and router setup
│   ├── app/                            # SPA-specific code
│   │   ├── core/
│   │   │   ├── page-manager.js         # Page lifecycle management
│   │   │   └── router.js               # History API router
│   │   └── pages/                      # SPA page modules
│   │       ├── _template.js            # Page template
│   │       ├── categories-page.js/.html
│   │       ├── documents-page.js/.html
│   │       ├── home-page.js/.html
│   │       ├── manager-dashboard-page.js/.html
│   │       ├── propose-recipe-page.js/.html
│   │       └── recipe-detail-page.js/.html
│   ├── js/                             # JavaScript modules
│   │   ├── config/
│   │   │   └── firebase-config.js      # Firebase configuration
│   │   ├── navigation-script.js        # Global navigation
│   │   ├── services/                   # Service layer (Firebase abstraction)
│   │   │   ├── auth-service.js
│   │   │   ├── firebase-service.js
│   │   │   ├── firestore-service.js
│   │   │   └── storage-service.js
│   │   ├── sw-register.js              # Service worker registration
│   │   └── utils/                      # Utility functions
│   │       ├── error-handler.js
│   │       ├── lazy-loading.js
│   │       └── recipes/                # Recipe-specific utilities
│   │           ├── recipe-data-utils.js
│   │           ├── recipe-image-utils.js
│   │           └── recipe-ingredients-utils.js
│   ├── lib/                            # Reusable components
│   │   ├── auth/                       # Authentication components
│   │   │   ├── auth-controller.js
│   │   │   └── components/
│   │   │       ├── auth-avatar.js
│   │   │       ├── auth-content.js
│   │   │       ├── forgot-password.js
│   │   │       ├── login-form.js
│   │   │       ├── signup-form.js
│   │   │       └── user-profile.js
│   │   ├── images/                     # Image handling components
│   │   ├── modals/                     # Modal components
│   │   │   ├── confirmation_modal/
│   │   │   ├── filter_modal/
│   │   │   ├── image_approval/
│   │   │   ├── message-modal/
│   │   │   └── missing_image_upload/
│   │   ├── recipes/                    # Recipe-related components
│   │   │   ├── recipe-card/
│   │   │   ├── recipe_component/
│   │   │   ├── recipe_form_component/
│   │   │   └── recipe_preview_modal/
│   │   ├── search/                     # Search components
│   │   │   ├── filter-search-bar/
│   │   │   ├── header-search-bar/
│   │   │   └── search-service/
│   │   └── utilities/                  # Utility components
│   │       ├── element-scroller/
│   │       ├── image-carousel/
│   │       ├── loading-spinner/
│   │       ├── media-scroller/
│   │       ├── modal/
│   │       ├── pdf_viewer/
│   │       ├── scrolling_list/
│   │       └── tab_switching/
│   └── styles/                         # CSS files
│       ├── base.css                    # Base styles
│       ├── main.css                    # Main CSS entry point
│       ├── components/                 # Component-specific styles
│       │   ├── base_button.css
│       │   ├── footer.css
│       │   ├── header.css
│       │   ├── lazy-loading.css
│       │   ├── print_recipe.css
│       │   ├── quote.css
│       │   ├── search_bar.css
│       │   └── spa.css                 # SPA-specific styles
│       └── pages/                      # SPA page-specific styles
│           ├── _template-spa.css
│           ├── categories-spa.css
│           ├── documents-spa.css
│           ├── home-spa.css
│           ├── manager-dashboard-spa.css
│           ├── propose-recipe-spa.css
│           └── recipe-detail-spa.css
├── tests/                              # Jest tests
│   ├── common/
│   │   └── mocks/                      # Mock files for testing
│   │       ├── firebase-*.mock.js      # Firebase service mocks
│   │       └── document.mock.js        # DOM mocks
│   ├── services/                       # Service layer tests
│   │   ├── auth-service.test.mjs
│   │   ├── firebase-service.test.mjs
│   │   ├── firestore-service.test.mjs
│   │   └── storage-service.test.mjs
│   └── utils/                          # Utility function tests
│       └── recipes/
│           ├── recipe-data-utils.test.mjs
│           ├── recipe-image-utils.test.mjs
│           └── recipe-ingredients-utils.test.mjs
├── index.html                          # SPA shell (main entry point)
├── vite.config.js                      # Vite build configuration
├── package.json                        # Dependencies and scripts
├── jest.config.mjs                     # Jest testing configuration
├── eslint.config.js                    # ESLint configuration
├── netlify.toml                        # Netlify deployment config
├── CLAUDE.md                           # Development guidelines
├── CLAUDE.local.md                     # Local development notes
└── README.md                           # Project documentation
```

## Architecture Notes

### SPA Structure

- **Single Entry Point**: `index.html` serves the entire application
- **History API Routing**: Clean URLs without hash fragments
- **Code Splitting**: Pages are loaded dynamically via dynamic imports
- **Service Layer**: All Firebase operations go through service abstraction
- **Component Library**: Reusable components in `src/lib/`

### Key Directories

**`src/app/`** - SPA-specific code

- `core/` - Router and page manager
- `pages/` - Individual page modules with templates

**`src/js/services/`** - Firebase service abstraction layer

- All Firebase operations go through this layer
- Never import Firebase SDKs directly in UI components

**`src/lib/`** - Reusable UI components organized by domain

- `auth/` - Authentication components
- `recipes/` - Recipe-related components
- `modals/` - Modal dialogs
- `search/` - Search functionality
- `utilities/` - General utility components

**`src/styles/`** - CSS organized by components and pages

- `components/` - Component-specific styles
- `pages/` - SPA page-specific styles (scoped to `.spa-content`)

**`public/`** - Static assets served directly by Vite

- Images, PWA manifest, service worker

**`tests/`** - Jest tests with comprehensive mocking

- Service layer tests with Firebase mocking
- Utility function tests

### Removed Legacy Structure

The following were removed during SPA migration:

- `/pages/` directory (legacy MPA pages)
- Legacy page-specific JS files
- Legacy page-specific CSS files
- Multiple entry points in Vite config

### Build Output

- Single HTML entry point with dynamically loaded page modules
- Optimized bundle splitting for better caching
- All static assets served from `public/` directory
- Clean URLs with History API routing

### Development Workflow

1. Create page module in `src/app/pages/`
2. Create HTML template alongside JS file
3. Create scoped styles in `src/styles/pages/`
4. Register route in `src/app.js`
5. Components use service layer for data operations
