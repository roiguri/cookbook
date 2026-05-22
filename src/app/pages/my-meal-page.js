import authService from '../../js/services/auth/auth-service.js';
import { ActiveMealService } from '../../js/services/meals/active-meal-service.js';
import { getRecipeById } from '../../js/utils/recipes/recipe-data-utils.js';
import {
  formatIngredientAmount,
  scaleIngredients,
} from '../../js/utils/recipes/recipe-ingredients-utils.js';
import { AppConfig } from '../../js/config/app-config.js';
import { icons } from '../../js/icons.js';
import '../../lib/modals/confirmation_modal/confirmation_modal.js';
import '../../styles/pages/my-meal-page.css';

export default {
  async render() {
    const response = await fetch(new URL('./my-meal-page.html', import.meta.url));
    if (!response.ok) {
      throw new Error(`Failed to load template: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  },

  async mount(container) {
    this.container = container;

    // Wait for authentication to resolve before checking
    this.currentUser = await authService.waitForAuth();

    if (!this.currentUser) {
      this.redirectToHome();
      return;
    }

    this.state = {
      meal: null,
      recipes: {}, // Cache for recipe data
      activeTabId: null,
      drawerOpen: false,
      ingredientsView: 'all', // 'all' or 'current'
      unselectedIngredients: new Set(),
    };

    this._pageReady = false;
    this.setupAuthObserver();
    await this.initializeRecipeComponent();
    this.setupIngredientsDrawer();
    this.subscribeToMealData();
  },

  redirectToHome() {
    if (window.spa && window.spa.router) {
      window.spa.router.navigate('/');
    } else {
      window.location.href = '/';
    }
  },

  setupAuthObserver() {
    this.authUnsubscribe = authService.onAuthStateChanged((user) => {
      if (!user) {
        this.redirectToHome();
      }
    });
  },

  async initializeRecipeComponent() {
    await import('../../lib/recipes/recipe_component/recipe_component.js');
  },

  subscribeToMealData() {
    let resolveFirstSnapshot;
    this._firstDataPromise = new Promise((resolve) => {
      resolveFirstSnapshot = resolve;
    });

    this.unsubscribe = ActiveMealService.subscribe(this.currentUser.uid, async (mealData) => {
      if (mealData) {
        await this.updateMealState(mealData);
      } else {
        this.renderEmptyState();
      }
      resolveFirstSnapshot?.();
      resolveFirstSnapshot = null;
    });
  },

  async updateMealState(mealData) {
    // Sync unselectedIngredients state from firebase
    if (mealData.recipeStates) {
      this.state.unselectedIngredients = new Set();
      Object.entries(mealData.recipeStates).forEach(([recipeId, state]) => {
        if (state.unselectedIngredients && Array.isArray(state.unselectedIngredients)) {
          state.unselectedIngredients.forEach((key) => this.state.unselectedIngredients.add(key));
        }
      });
    }
    this.state.meal = mealData;

    // Fetch missing recipes
    const recipeIds = mealData.recipeIds || [];
    const missingIds = recipeIds.filter((id) => !this.state.recipes[id]);

    if (missingIds.length > 0) {
      await Promise.all(
        missingIds.map(async (id) => {
          try {
            const recipe = await getRecipeById(id);
            if (recipe) {
              this.state.recipes[id] = recipe;
            }
          } catch (error) {
            console.error(`Failed to fetch recipe ${id}`, error);
          }
        }),
      );
    }

    // Determine active recipe
    const activeRecipeId = mealData.activeRecipeId || (recipeIds.length > 0 ? recipeIds[0] : null);

    // Only re-render tabs when the recipe list or active recipe changes — not on every snapshot
    // (e.g. ingredient selection writes trigger snapshots but shouldn't rebuild tab DOM)
    const tabKey = `${recipeIds.join(',')}_${activeRecipeId}`;
    if (tabKey !== this.state._lastTabKey) {
      this.renderTabs(recipeIds, activeRecipeId);
      this.state._lastTabKey = tabKey;
    }

    // Render active recipe
    if (activeRecipeId && activeRecipeId !== this.state.activeTabId) {
      this.renderActiveRecipe(activeRecipeId);
    } else if (activeRecipeId) {
      // Just update attributes if needed (e.g. if updated from another device)
      // But we need to be careful not to override local interaction if it's lagging
      // For now, let's assume RecipeComponent handles its own internal state unless we explicitly change activeRecipeId
      // Actually, we should sync servings and step if they changed externally
      this.syncActiveRecipeState(activeRecipeId);
    }

    // Update ingredients list if drawer is open
    if (this.state.drawerOpen) {
      this.renderIngredientsList();
    }
  },

  renderTabs(recipeIds, activeId) {
    const tabList = this.container.querySelector('.kitchen-switcher');
    tabList.innerHTML = '';

    recipeIds.forEach((id) => {
      const recipe = this.state.recipes[id];
      if (!recipe) return;

      const isActive = id === activeId;

      const tab = document.createElement('button');
      tab.className = `recipe-tab ${isActive ? 'active' : ''}`;

      // Tab content container for better layout control
      const tabContent = document.createElement('div');
      tabContent.className = 'tab-content';
      tabContent.style.display = 'flex';
      tabContent.style.alignItems = 'center';
      tabContent.style.gap = '8px';

      const tabName = document.createElement('span');
      tabName.className = 'tab-name';
      tabName.textContent = recipe.name;

      // Remove button
      const removeBtn = document.createElement('span');
      removeBtn.className = 'remove-recipe-btn';
      removeBtn.innerHTML = icons.times;
      removeBtn.title = 'הסר מתכון';
      removeBtn.onclick = (e) => this.handleRemoveRecipe(e, id);

      tabContent.appendChild(tabName);
      tabContent.appendChild(removeBtn);

      tab.appendChild(tabContent);

      tab.addEventListener('click', (e) => {
        // Prevent switching if clicking remove button (though handled by propagation stop in remove handler, just in case)
        if (e.target.closest('.remove-recipe-btn')) return;
        this.switchRecipe(id);
      });
      tabList.appendChild(tab);
    });

    if (recipeIds.length > 0) {
      // Add Clear All button at the end
      const clearBtn = document.createElement('button');
      clearBtn.className = 'recipe-tab clear-all-btn';
      clearBtn.title = 'נקה הכל';
      clearBtn.innerHTML = icons.trashAlt;
      clearBtn.onclick = () => this.handleClearMeal();
      tabList.appendChild(clearBtn);
    } else {
      this.renderEmptyState();
    }
  },

  async handleRemoveRecipe(e, recipeId) {
    e.stopPropagation();
    const confirmed = await this.container
      .querySelector('#confirmation-modal')
      .confirm('האם להסיר את המתכון מהארוחה?');
    if (!confirmed) return;

    // Detect if we need to switch tabs
    if (this.state.activeTabId === recipeId) {
      const recipeIds = this.state.meal.recipeIds || [];
      const index = recipeIds.indexOf(recipeId);

      let nextId = null;
      if (recipeIds.length > 1) {
        // If there is a previous recipe, go to it. Otherwise go to the next one (which will become first)
        if (index > 0) {
          nextId = recipeIds[index - 1];
        } else {
          nextId = recipeIds[index + 1]; // It was the first one, so go to the second one
        }
      }

      if (nextId) {
        await this.switchRecipe(nextId);
      }
    }

    await ActiveMealService.removeFromMeal(this.currentUser.uid, recipeId);
  },

  async handleClearMeal() {
    const confirmed = await this.container
      .querySelector('#confirmation-modal')
      .confirm('האם לנקות את כל הארוחה? פעולה זו תסיר את כל המתכונים.');
    if (!confirmed) return;

    await ActiveMealService.clearMeal(this.currentUser.uid);
    // UI update will happen automatically via onSnapshot
  },

  async switchRecipe(recipeId) {
    if (this.state.activeTabId === recipeId) return;

    // Save current state is handled by event listeners on the component

    // Update active recipe in Firestore
    await ActiveMealService.switchRecipe(this.currentUser.uid, recipeId);
  },

  renderActiveRecipe(recipeId) {
    this.state.activeTabId = recipeId;
    const container = this.container.querySelector('#recipe-container');
    container.innerHTML = '';

    let loader = null;
    if (this._pageReady) {
      loader = document.createElement('div');
      loader.className = 'recipe-container-loader';
      container.appendChild(loader);
    }

    const recipeState = this.state.meal.recipeStates?.[recipeId] || {};

    const component = document.createElement('recipe-component');
    component.setAttribute('recipe-id', recipeId);

    if (recipeState.servings) {
      component.setAttribute('initial-servings', recipeState.servings);
    }

    if (recipeState.currentStepIndex !== undefined) {
      component.setAttribute('active-step', recipeState.currentStepIndex);
    }

    if (loader) {
      component.addEventListener('recipe-data-loaded', () => loader.remove(), { once: true });
    }

    // Listen for state changes
    component.addEventListener('active-step-changed', (e) => {
      this.updateRecipeState(recipeId, { currentStepIndex: e.detail.stepIndex });
    });

    component.addEventListener('servings-changed', (e) => {
      this.updateRecipeState(recipeId, { servings: e.detail.servings });
      if (this.state.drawerOpen) this.renderIngredientsList();
    });

    container.appendChild(component);
  },

  syncActiveRecipeState(recipeId) {
    const container = this.container.querySelector('#recipe-container');
    const component = container.querySelector('recipe-component');
    if (!component || component.getAttribute('recipe-id') !== recipeId) return;

    const recipeState = this.state.meal.recipeStates?.[recipeId] || {};

    // Update attributes if they differ from current (this might cause re-renders or updates in component)
    // We check if the attribute is different to avoid unnecessary updates
    if (
      recipeState.servings &&
      component.getAttribute('initial-servings') != recipeState.servings
    ) {
      component.setAttribute('initial-servings', recipeState.servings);
    }

    if (
      recipeState.currentStepIndex !== undefined &&
      component.getAttribute('active-step') != recipeState.currentStepIndex
    ) {
      component.setAttribute('active-step', recipeState.currentStepIndex);
    }
  },

  async updateRecipeState(recipeId, updates) {
    // We don't need to manually merge state here anymore as the utils handle dot notation updates
    // allowing us to update just specific fields without fetching the whole object.

    // However, for local consistency until next snapshot, we might want to update local state if needed.
    // But since we rely on snapshot, it should be fine.

    await ActiveMealService.updateRecipeState(this.currentUser.uid, recipeId, updates);
  },

  setupIngredientsDrawer() {
    const drawer = this.container.querySelector('#ingredients-drawer');
    const backdrop = this.container.querySelector('#drawer-backdrop');
    const toggleBtn = this.container.querySelector('#toggle-ingredients-btn');
    const closeBtn = this.container.querySelector('#close-drawer-btn');
    const viewAllBtn = this.container.querySelector('#view-all-ingredients');
    const viewRecipeBtn = this.container.querySelector('#view-recipe-ingredients');
    const selectAllBtn = this.container.querySelector('#select-all-ingredients-btn');
    const deselectAllBtn = this.container.querySelector('#deselect-all-ingredients-btn');

    const copyBtn = this.container.querySelector('#copy-ingredients-btn');
    const shareBtn = this.container.querySelector('#share-ingredients-btn');

    // Show share button if supported
    if (navigator.share) {
      shareBtn.classList.remove('hidden');
    }

    const toggleDrawer = () => {
      this.state.drawerOpen = !this.state.drawerOpen;
      if (this.state.drawerOpen) {
        drawer.classList.add('open');
        backdrop.classList.add('open');
        this.renderIngredientsList();
      } else {
        drawer.classList.remove('open');
        backdrop.classList.remove('open');
      }
    };

    const getIngredientsText = () => {
      const recipeIds =
        this.state.ingredientsView === 'current'
          ? this.state.activeTabId
            ? [this.state.activeTabId]
            : []
          : this.state.meal?.recipeIds || [];

      let text = 'רשימת מצרכים:\n\n';

      recipeIds.forEach((id) => {
        const recipe = this.state.recipes[id];
        if (!recipe) return;

        let recipeHasItems = this._recipeHasSelectedItems(recipe, id);
        if (!recipeHasItems) return;

        text += `${recipe.name}\n`;
        text += '-'.repeat(recipe.name.length) + '\n';

        const state = this.state.meal.recipeStates?.[id];
        const servings = state?.servings || recipe.servings;
        const originalIngredients = recipe.ingredientSections || recipe.ingredients;

        let scaledIngredients;
        if (recipe.ingredientSections) {
          scaledIngredients = scaleIngredients(originalIngredients, recipe.servings, servings);
          scaledIngredients.forEach((section, sIndex) => {
            let sectionHasItems = false;
            let sectionText = '';

            if (section.title) {
              sectionText += `\n${section.title}:\n`;
            }
            section.items.forEach((item, iIndex) => {
              const key = `${id}-${sIndex}-${iIndex}`;
              if (!this.state.unselectedIngredients.has(key)) {
                sectionText += `- ${formatIngredientAmount(item.amount)} ${item.unit} ${item.item}\n`;
                sectionHasItems = true;
              }
            });
            if (sectionHasItems) {
              text += sectionText;
            }
          });
        } else {
          scaledIngredients = scaleIngredients(originalIngredients, recipe.servings, servings);
          scaledIngredients.forEach((item, iIndex) => {
            const key = `${id}-0-${iIndex}`;
            if (!this.state.unselectedIngredients.has(key)) {
              text += `- ${formatIngredientAmount(item.amount)} ${item.unit} ${item.item}\n`;
            }
          });
        }
        text += '\n'; // Spacer between recipes
      });

      return text;
    };

    copyBtn.addEventListener('click', async () => {
      const text = getIngredientsText();
      try {
        await navigator.clipboard.writeText(text);
        // Simple visual feedback could be improved with a toast
        const originalIcon = copyBtn.innerHTML;
        copyBtn.innerHTML = icons.check;
        setTimeout(() => {
          copyBtn.innerHTML = originalIcon;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy: ', err);
      }
    });

    shareBtn.addEventListener('click', async () => {
      const text = getIngredientsText();
      try {
        await navigator.share({
          title: 'רשימת מצרכים',
          text: text,
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
      }
    });

    toggleBtn.addEventListener('click', toggleDrawer);
    closeBtn.addEventListener('click', toggleDrawer);
    backdrop.addEventListener('click', toggleDrawer);

    viewAllBtn.addEventListener('click', () => {
      this.state.ingredientsView = 'all';
      viewAllBtn.classList.add('active');
      viewRecipeBtn.classList.remove('active');
      this.renderIngredientsList();
    });

    viewRecipeBtn.addEventListener('click', () => {
      this.state.ingredientsView = 'current';
      viewRecipeBtn.classList.add('active');
      viewAllBtn.classList.remove('active');
      this.renderIngredientsList();
    });

    selectAllBtn.addEventListener('click', () => this.handleGlobalIngredientSelection(true));
    deselectAllBtn.addEventListener('click', () => this.handleGlobalIngredientSelection(false));
  },

  async handleGlobalIngredientSelection(shouldSelect) {
    const allRecipeIds = this.state.meal?.recipeIds || [];
    const keys = [];
    allRecipeIds.forEach((id) => {
      const recipe = this.state.recipes[id];
      if (!recipe) return;
      if (recipe.ingredientSections) {
        recipe.ingredientSections.forEach((section, sIndex) => {
          section.items.forEach((_, iIndex) => {
            keys.push({ recipeId: id, key: `${id}-${sIndex}-${iIndex}` });
          });
        });
      } else if (recipe.ingredients) {
        recipe.ingredients.forEach((_, iIndex) => {
          keys.push({ recipeId: id, key: `${id}-0-${iIndex}` });
        });
      }
    });

    const recipesToUpdate = new Set();
    let hasChanges = false;
    keys.forEach(({ recipeId, key }) => {
      const isUnselected = this.state.unselectedIngredients.has(key);
      if (shouldSelect && isUnselected) {
        this.state.unselectedIngredients.delete(key);
        hasChanges = true;
        recipesToUpdate.add(recipeId);
      } else if (!shouldSelect && !isUnselected) {
        this.state.unselectedIngredients.add(key);
        hasChanges = true;
        recipesToUpdate.add(recipeId);
      }
    });

    if (hasChanges) {
      const promises = Array.from(recipesToUpdate).map((recipeId) => {
        const unselectedArr = Array.from(this.state.unselectedIngredients).filter((k) =>
          k.startsWith(`${recipeId}-`),
        );
        return ActiveMealService.updateRecipeState(this.currentUser.uid, recipeId, {
          unselectedIngredients: unselectedArr,
        });
      });
      await Promise.all(promises);
      this.renderIngredientsList();
    }
  },

  async handleBulkIngredientSelection(shouldSelect, recipeId) {
    const keys = this.getCurrentViewIngredientKeys(recipeId);
    const recipesToUpdate = new Set();
    let hasChanges = false;

    keys.forEach(({ recipeId, key }) => {
      const isUnselected = this.state.unselectedIngredients.has(key);
      if (shouldSelect && isUnselected) {
        this.state.unselectedIngredients.delete(key);
        hasChanges = true;
        recipesToUpdate.add(recipeId);
      } else if (!shouldSelect && !isUnselected) {
        this.state.unselectedIngredients.add(key);
        hasChanges = true;
        recipesToUpdate.add(recipeId);
      }
    });

    if (hasChanges) {
      const promises = Array.from(recipesToUpdate).map((recipeId) => {
        const unselectedArr = Array.from(this.state.unselectedIngredients).filter((k) =>
          k.startsWith(`${recipeId}-`),
        );
        return ActiveMealService.updateRecipeState(this.currentUser.uid, recipeId, {
          unselectedIngredients: unselectedArr,
        });
      });
      await Promise.all(promises);
      this.renderIngredientsList();
    }
  },

  _recipeHasSelectedItems(recipe, recipeId) {
    if (recipe.ingredientSections) {
      return recipe.ingredientSections.some((section, sIndex) =>
        section.items.some(
          (_, iIndex) => !this.state.unselectedIngredients.has(`${recipeId}-${sIndex}-${iIndex}`),
        ),
      );
    }
    if (recipe.ingredients) {
      return recipe.ingredients.some(
        (_, iIndex) => !this.state.unselectedIngredients.has(`${recipeId}-0-${iIndex}`),
      );
    }
    return false;
  },

  _areAllItemsSelected(recipeId) {
    const keys = this.getCurrentViewIngredientKeys(recipeId);
    if (keys.length === 0) return false;
    return keys.every(({ key }) => !this.state.unselectedIngredients.has(key));
  },

  _areSomeItemsSelected(recipeId) {
    const keys = this.getCurrentViewIngredientKeys(recipeId);
    return keys.some(({ key }) => !this.state.unselectedIngredients.has(key));
  },

  getCurrentViewIngredientKeys(targetRecipeId) {
    const keys = [];
    const recipeIds = targetRecipeId
      ? [targetRecipeId]
      : this.state.ingredientsView === 'current'
        ? this.state.activeTabId
          ? [this.state.activeTabId]
          : []
        : this.state.meal?.recipeIds || [];

    recipeIds.forEach((id) => {
      const recipe = this.state.recipes[id];
      if (!recipe) return;

      if (recipe.ingredientSections) {
        recipe.ingredientSections.forEach((section, sIndex) => {
          section.items.forEach((item, iIndex) => {
            keys.push({ recipeId: id, key: `${id}-${sIndex}-${iIndex}` });
          });
        });
      } else {
        recipe.ingredients.forEach((item, iIndex) => {
          keys.push({ recipeId: id, key: `${id}-0-${iIndex}` });
        });
      }
    });
    return keys;
  },

  async toggleIngredientSelection(recipeId, key) {
    if (this.state.unselectedIngredients.has(key)) {
      this.state.unselectedIngredients.delete(key);
    } else {
      this.state.unselectedIngredients.add(key);
    }
    this.renderIngredientsList();

    // Save state
    const unselectedArr = Array.from(this.state.unselectedIngredients).filter((k) =>
      k.startsWith(recipeId + '-'),
    );
    await ActiveMealService.updateRecipeState(this.currentUser.uid, recipeId, {
      unselectedIngredients: unselectedArr,
    });
  },

  renderIngredientsList() {
    const listContainer = this.container.querySelector('#ingredients-list-container');
    listContainer.innerHTML = '';

    const recipeIds =
      this.state.ingredientsView === 'current'
        ? this.state.activeTabId
          ? [this.state.activeTabId]
          : []
        : this.state.meal?.recipeIds || [];

    const allIngredients = [];

    recipeIds.forEach((id) => {
      const recipe = this.state.recipes[id];
      const state = this.state.meal.recipeStates?.[id];

      if (!recipe) return;

      const servings = state?.servings || recipe.servings;
      const originalIngredients = recipe.ingredientSections || recipe.ingredients;

      let scaledIngredients;
      if (recipe.ingredientSections) {
        scaledIngredients = scaleIngredients(originalIngredients, recipe.servings, servings);
        scaledIngredients.forEach((section) => {
          section.items.forEach((item) => {
            allIngredients.push({ ...item, recipeName: recipe.name });
          });
        });
      } else {
        scaledIngredients = scaleIngredients(originalIngredients, recipe.servings, servings);
        scaledIngredients.forEach((item) => {
          allIngredients.push({ ...item, recipeName: recipe.name });
        });
      }
    });

    // Consolidate ingredients (optional, simple list for now)
    // To properly consolidate, we need to normalize units and names, which might be complex.
    // For now, let's list them grouped by recipe if viewing all, or just list them.

    // Group by recipe for clarity when viewing "All"
    if (this.state.ingredientsView === 'all') {
      recipeIds.forEach((id) => {
        const recipe = this.state.recipes[id];
        if (!recipe) return;

        const headerContainer = document.createElement('div');
        headerContainer.className = 'recipe-section-header';

        const allSelected = this._areAllItemsSelected(id);
        const someSelected = this._areSomeItemsSelected(id);

        const label = document.createElement('label');
        label.className = 'recipe-checkbox-label';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ingredient-checkbox';
        checkbox.checked = allSelected;
        checkbox.indeterminate = someSelected && !allSelected;
        checkbox.addEventListener('change', () =>
          this.handleBulkIngredientSelection(!allSelected, id),
        );

        const box = document.createElement('span');
        box.className = 'check-box';

        const recipeHeader = document.createElement('h3');
        recipeHeader.textContent = recipe.name;

        label.appendChild(checkbox);
        label.appendChild(box);
        label.appendChild(recipeHeader);

        headerContainer.appendChild(label);
        listContainer.appendChild(headerContainer);

        const ul = document.createElement('ul');
        const state = this.state.meal.recipeStates?.[id];
        const servings = state?.servings || recipe.servings;
        const originalIngredients = recipe.ingredientSections || recipe.ingredients;

        let scaledIngredients;
        if (recipe.ingredientSections) {
          scaledIngredients = scaleIngredients(originalIngredients, recipe.servings, servings);
        } else {
          scaledIngredients = scaleIngredients(originalIngredients, recipe.servings, servings);
        }

        const renderItems = (items, sIndex) => {
          items.forEach((item, iIndex) => {
            const li = document.createElement('li');
            const key = `${id}-${sIndex}-${iIndex}`;
            const isUnselected = this.state.unselectedIngredients.has(key);

            const label = document.createElement('label');
            label.className = `ingredient-label${isUnselected ? ' unselected' : ''}`;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'ingredient-checkbox';
            checkbox.checked = !isUnselected;
            checkbox.addEventListener('change', () => this.toggleIngredientSelection(id, key));

            const box = document.createElement('span');
            box.className = 'check-box';

            const amountSpan = document.createElement('span');
            amountSpan.className = 'amount';
            amountSpan.textContent = formatIngredientAmount(item.amount);
            // Keep "1 1/2" LTR-isolated inside the RTL Hebrew layout.
            amountSpan.setAttribute('dir', 'ltr');
            amountSpan.style.unicodeBidi = 'isolate';

            const unitSpan = document.createElement('span');
            unitSpan.className = 'unit';
            unitSpan.textContent = item.unit;

            const itemSpan = document.createElement('span');
            itemSpan.className = 'item';
            itemSpan.textContent = item.item;

            label.appendChild(checkbox);
            label.appendChild(box);
            label.appendChild(amountSpan);
            label.appendChild(document.createTextNode(' '));
            label.appendChild(unitSpan);
            label.appendChild(document.createTextNode(' '));
            label.appendChild(itemSpan);

            li.appendChild(label);
            ul.appendChild(li);
          });
        };

        if (recipe.ingredientSections) {
          scaledIngredients.forEach((section, sIndex) => {
            if (section.title) {
              const sectionTitle = document.createElement('li');
              sectionTitle.className = 'section-title';
              sectionTitle.textContent = section.title;
              ul.appendChild(sectionTitle);
            }
            renderItems(section.items, sIndex);
          });
        } else {
          renderItems(scaledIngredients, 0);
        }
        listContainer.appendChild(ul);
      });
    } else {
      // Single recipe view
      if (recipeIds.length > 0) {
        const recipe = this.state.recipes[recipeIds[0]];
        const state = this.state.meal.recipeStates?.[recipeIds[0]];
        const servings = state?.servings || recipe.servings;
        const originalIngredients = recipe.ingredientSections || recipe.ingredients;

        let scaledIngredients;
        if (recipe.ingredientSections) {
          scaledIngredients = scaleIngredients(originalIngredients, recipe.servings, servings);
        } else {
          scaledIngredients = scaleIngredients(originalIngredients, recipe.servings, servings);
        }

        const ul = document.createElement('ul');

        const renderItems = (items, sIndex) => {
          items.forEach((item, iIndex) => {
            const li = document.createElement('li');
            const key = `${recipeIds[0]}-${sIndex}-${iIndex}`;
            const isUnselected = this.state.unselectedIngredients.has(key);

            const label = document.createElement('label');
            label.className = `ingredient-label${isUnselected ? ' unselected' : ''}`;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'ingredient-checkbox';
            checkbox.checked = !isUnselected;
            checkbox.addEventListener('change', () =>
              this.toggleIngredientSelection(recipeIds[0], key),
            );

            const box = document.createElement('span');
            box.className = 'check-box';

            const amountSpan = document.createElement('span');
            amountSpan.className = 'amount';
            amountSpan.textContent = formatIngredientAmount(item.amount);
            // Keep "1 1/2" LTR-isolated inside the RTL Hebrew layout.
            amountSpan.setAttribute('dir', 'ltr');
            amountSpan.style.unicodeBidi = 'isolate';

            const unitSpan = document.createElement('span');
            unitSpan.className = 'unit';
            unitSpan.textContent = item.unit;

            const itemSpan = document.createElement('span');
            itemSpan.className = 'item';
            itemSpan.textContent = item.item;

            label.appendChild(checkbox);
            label.appendChild(box);
            label.appendChild(amountSpan);
            label.appendChild(document.createTextNode(' '));
            label.appendChild(unitSpan);
            label.appendChild(document.createTextNode(' '));
            label.appendChild(itemSpan);

            li.appendChild(label);
            ul.appendChild(li);
          });
        };

        if (recipe.ingredientSections) {
          scaledIngredients.forEach((section, sIndex) => {
            if (section.title) {
              const sectionTitle = document.createElement('li');
              sectionTitle.className = 'section-title';
              sectionTitle.textContent = section.title;
              ul.appendChild(sectionTitle);
            }
            renderItems(section.items, sIndex);
          });
        } else {
          renderItems(scaledIngredients, 0);
        }
        listContainer.appendChild(ul);
      }
    }
  },

  renderEmptyState() {
    this.container.innerHTML = `
      <div class="my-meal-page">
        <div class="empty-state">
          <div class="empty-state-card">
            <div class="empty-icon-wrapper">
              ${icons.kitchenUtensils}
            </div>
            <h2 class="heading-2-he">אין ארוחה פעילה</h2>
            <p class="empty-subtitle">התחל להוסיף מתכונים לארוחה שלך<br>כדי לראות אותם כאן</p>
            <button id="empty-go-categories" class="btn btn-primary btn-lg empty-cta">חפש מתכונים</button>
          </div>
        </div>
      </div>
    `;
    this.container.querySelector('#empty-go-categories').addEventListener('click', () => {
      if (window.spa?.router) window.spa.router.navigate('/categories');
      else window.location.hash = '#/categories';
    });
  },

  async waitForReady() {
    if (this._firstDataPromise) await this._firstDataPromise;
    this._pageReady = true;
  },

  unmount() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
    }
  },

  getTitle() {
    return AppConfig.getPageTitle('הארוחה שלי');
  },

  getMeta() {
    return {
      description: 'Manage your cooking session',
      keywords: 'cooking, meal, recipes',
    };
  },
};
