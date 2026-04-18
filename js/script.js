/* ============================================================
   Expense & Budget Visualizer — script.js
   Vanilla JS ES6+, IIFE/namespace pattern, no bundler.
   All modules live inside this single IIFE.
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     SECTION 0 — App State (in-memory, not persisted)
     ============================================================ */

  const state = {
    transactions:   [],   // Transaction[]
    categories:     [],   // string[]
    budget:         null, // number | null
    sortBy:         'newest',
    filterCategory: 'all',
  };

  /* ============================================================
     SECTION 1 — TransactionStore
     Responsible for reading/writing Transaction records to
     localStorage and triggering re-renders on mutation.
     localStorage key: ebv_transactions
     ============================================================ */

  const TransactionStore = {
    /**
     * getData() → Transaction[]
     * Reads and deserializes transactions from localStorage.
     * Falls back to [] on missing or malformed data.
     */
    getData() {
      try {
        const raw = localStorage.getItem('ebv_transactions');
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(tx =>
          tx &&
          typeof tx.id === 'string' && tx.id !== '' &&
          typeof tx.name === 'string' && tx.name !== '' &&
          typeof tx.amount === 'number' &&
          typeof tx.category === 'string' && tx.category !== '' &&
          typeof tx.timestamp === 'string' && tx.timestamp !== ''
        );
      } catch (err) {
        console.warn('TransactionStore.getData: failed to read transactions from localStorage', err);
        return [];
      }
    },

    /**
     * saveData(list) → void
     * Serializes and writes the transaction list to localStorage.
     * Catches quota errors and shows a toast.
     * @param {Array} list
     */
    saveData(list) {
      try {
        localStorage.setItem('ebv_transactions', JSON.stringify(list));
      } catch (err) {
        console.error('TransactionStore.saveData: failed to write to localStorage', err);
        ToastController.show('Could not save data. Storage may be full.', 3000);
      }
    },

    /**
     * add(tx) → void
     * Appends a transaction, saves, and triggers renderAll().
     * @param {Object} tx
     */
    add(tx) {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString();
      const newTx = Object.assign({ id }, tx);
      state.transactions.push(newTx);
      this.saveData(state.transactions);
      renderAll();
    },

    /**
     * remove(id) → void
     * Removes a transaction by id, saves, and triggers renderAll().
     * @param {string} id
     */
    remove(id) {
      state.transactions = state.transactions.filter(tx => tx.id !== id);
      this.saveData(state.transactions);
      renderAll();
    },
  };

  /* ============================================================
     SECTION 2 — Validator
     Validates Expense_Form inputs before submission.
     Manages inline error messages adjacent to fields.
     ============================================================ */

  const Validator = {
    /**
     * validate(name, amount, category) → { valid: boolean, errors: {} }
     * Returns validation result with per-field error messages.
     * @param {string} name
     * @param {string} amount
     * @param {string} category
     */
    validate(name, amount, category) {
      const errors = {};

      if (!name || name.trim() === '') {
        errors.name = 'Item name is required.';
      }

      if (amount === '' || amount === null || amount === undefined) {
        errors.amount = 'Amount is required.';
      } else {
        const num = Number(amount);
        if (isNaN(num) || num <= 0) {
          errors.amount = 'Amount must be a positive number.';
        }
      }

      if (!category || category === '') {
        errors.category = 'Please select a category.';
      }

      return { valid: Object.keys(errors).length === 0, errors };
    },

    /**
     * showError(fieldEl, message) → void
     * Inserts an inline error element below the given field.
     * @param {HTMLElement} fieldEl
     * @param {string} message
     */
    showError(fieldEl, message) {
      this.clearError(fieldEl);
      const span = document.createElement('span');
      span.className = 'field-error';
      span.textContent = message;
      fieldEl.insertAdjacentElement('afterend', span);
    },

    /**
     * clearError(fieldEl) → void
     * Removes the inline error element for the given field.
     * @param {HTMLElement} fieldEl
     */
    clearError(fieldEl) {
      const next = fieldEl.nextElementSibling;
      if (next && next.classList.contains('field-error')) {
        next.remove();
      }
    },

    /**
     * initClearOnInput() → void
     * Wires input event listeners on name, amount, and category fields
     * to clear their inline errors as soon as the user corrects the field.
     */
    initClearOnInput() {
      const nameEl     = document.getElementById('item-name');
      const amountEl   = document.getElementById('item-amount');
      const categoryEl = document.getElementById('item-category');

      if (nameEl)     nameEl.addEventListener('input',  () => this.clearError(nameEl));
      if (amountEl)   amountEl.addEventListener('input', () => this.clearError(amountEl));
      if (categoryEl) categoryEl.addEventListener('change', () => this.clearError(categoryEl));
    },
  };

  /* ============================================================
     SECTION 3 — CategoryManager
     Manages default + user-created categories.
     Handles dropdown population and color assignment.
     localStorage key: ebv_categories
     ============================================================ */

  const CategoryManager = {
    _defaults: ['Food', 'Transport', 'Fun'],

    _palette: [
      '#4f86c6', // blue
      '#e07b54', // orange
      '#6abf69', // green
      '#c97bb2', // purple
      '#e8c84a', // yellow
      '#5bbcb8', // teal
      '#e05c5c', // red
      '#8d7cc3', // violet
    ],

    /**
     * loadCategories() → void
     * Reads ebv_categories from localStorage, merges with defaults.
     */
    loadCategories() {
      let saved = [];
      try {
        const raw = localStorage.getItem('ebv_categories');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            saved = parsed.filter(c => typeof c === 'string' && c.trim() !== '');
          }
        }
      } catch (err) {
        console.warn('CategoryManager.loadCategories: failed to read from localStorage', err);
      }

      // Merge defaults + saved, no duplicates (case-insensitive)
      const merged = [...this._defaults];
      for (const cat of saved) {
        const lower = cat.toLowerCase();
        if (!merged.some(m => m.toLowerCase() === lower)) {
          merged.push(cat);
        }
      }
      state.categories = merged;
    },

    /**
     * getCategories() → string[]
     * Returns the current list of category names.
     */
    getCategories() {
      return state.categories;
    },

    /**
     * addCategory(name) → { ok: boolean, error?: string }
     * Validates and adds a new category; persists to localStorage.
     * @param {string} name
     */
    addCategory(name) {
      const trimmed = (name || '').trim();
      if (trimmed === '') {
        return { ok: false, error: 'Category name cannot be empty.' };
      }
      const lower = trimmed.toLowerCase();
      if (state.categories.some(c => c.toLowerCase() === lower)) {
        return { ok: false, error: 'Category already exists.' };
      }
      state.categories.push(trimmed);
      this.persistCategories();
      this.populateDropdowns();
      return { ok: true };
    },

    /**
     * persistCategories() → void
     * Writes current categories to localStorage.
     */
    persistCategories() {
      try {
        localStorage.setItem('ebv_categories', JSON.stringify(state.categories));
      } catch (err) {
        console.error('CategoryManager.persistCategories: failed to write to localStorage', err);
      }
    },

    /**
     * getCategoryColor(name) → string
     * Returns a deterministic hex color for the given category name.
     * @param {string} name
     */
    getCategoryColor(name) {
      let hash = 0;
      const str = String(name);
      for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
      }
      return this._palette[hash % this._palette.length];
    },

    /**
     * populateDropdowns() → void
     * Populates the category <select> and filter <select> with
     * current categories, appending "Add New Category…" to the form select.
     */
    populateDropdowns() {
      const categorySelect = document.getElementById('item-category');
      const filterSelect   = document.getElementById('filter-select');

      if (categorySelect) {
        // Preserve current selection if possible
        const currentVal = categorySelect.value;
        categorySelect.innerHTML = '<option value="">-- Select category --</option>';
        for (const cat of state.categories) {
          const opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat;
          categorySelect.appendChild(opt);
        }
        // "Add New Category…" always last
        const addOpt = document.createElement('option');
        addOpt.value = '__add_new__';
        addOpt.textContent = 'Add New Category\u2026';
        categorySelect.appendChild(addOpt);

        // Restore selection if it still exists
        if (currentVal && currentVal !== '__add_new__') {
          categorySelect.value = currentVal;
        }
      }

      if (filterSelect) {
        const currentFilter = filterSelect.value;
        filterSelect.innerHTML = '<option value="all">All</option>';
        for (const cat of state.categories) {
          const opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat;
          filterSelect.appendChild(opt);
        }
        // Restore filter selection
        if (currentFilter) {
          filterSelect.value = currentFilter;
        }
      }
    },

    /**
     * initEvents() → void
     * Wires the "Add New Category…" change event and the confirm button.
     */
    initEvents() {
      const categorySelect   = document.getElementById('item-category');
      const newCategoryWrapper = document.getElementById('new-category-wrapper');
      const newCategoryInput = document.getElementById('new-category-name');
      const addCategoryBtn   = document.getElementById('add-category-btn');
      const newCategoryError = document.getElementById('new-category-error');

      if (categorySelect && newCategoryWrapper) {
        categorySelect.addEventListener('change', () => {
          if (categorySelect.value === '__add_new__') {
            newCategoryWrapper.hidden = false;
            if (newCategoryInput) newCategoryInput.focus();
          } else {
            newCategoryWrapper.hidden = true;
            if (newCategoryError) {
              newCategoryError.hidden = true;
              newCategoryError.textContent = '';
            }
          }
        });
      }

      if (addCategoryBtn && newCategoryInput) {
        addCategoryBtn.addEventListener('click', () => {
          const result = this.addCategory(newCategoryInput.value);
          if (result.ok) {
            // Select the newly added category
            if (categorySelect) {
              categorySelect.value = newCategoryInput.value.trim();
            }
            newCategoryInput.value = '';
            if (newCategoryWrapper) newCategoryWrapper.hidden = true;
            if (newCategoryError) {
              newCategoryError.hidden = true;
              newCategoryError.textContent = '';
            }
          } else {
            if (newCategoryError) {
              newCategoryError.textContent = result.error;
              newCategoryError.hidden = false;
            }
          }
        });

        // Clear error on input
        newCategoryInput.addEventListener('input', () => {
          if (newCategoryError) {
            newCategoryError.hidden = true;
            newCategoryError.textContent = '';
          }
        });
      }
    },
  };

  /* ============================================================
     SECTION 4 — BudgetManager
     Stores and evaluates the monthly budget limit.
     localStorage key: ebv_budget
     ============================================================ */

  const BudgetManager = {
    /**
     * getBudget() → number | null
     * Reads the budget from localStorage.
     */
    getBudget() {
      try {
        const raw = localStorage.getItem('ebv_budget');
        if (raw === null) return null;
        const parsed = Number(raw);
        if (isNaN(parsed)) return null;
        return parsed;
      } catch (err) {
        console.warn('BudgetManager.getBudget: failed to read from localStorage', err);
        return null;
      }
    },

    /**
     * setBudget(value) → { ok: boolean, error?: string }
     * Validates and persists a positive budget value.
     * @param {number|string} value
     */
    setBudget(value) {
      const num = Number(value);
      if (isNaN(num) || num <= 0) {
        const errorEl = document.getElementById('budget-error');
        if (errorEl) {
          errorEl.textContent = 'Budget must be a positive number.';
          errorEl.hidden = false;
        }
        return { ok: false, error: 'Budget must be a positive number.' };
      }
      try {
        localStorage.setItem('ebv_budget', String(num));
      } catch (err) {
        console.error('BudgetManager.setBudget: failed to write to localStorage', err);
        ToastController.show('Could not save data. Storage may be full.', 3000);
      }
      state.budget = num;
      const errorEl = document.getElementById('budget-error');
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }
      return { ok: true };
    },

    /**
     * isOverBudget(transactions) → boolean
     * Returns true if monthly total exceeds the budget limit.
     * @param {Array} transactions
     */
    isOverBudget(transactions) {
      if (state.budget === null || state.budget === undefined) return false;
      return this.getMonthlyTotal(transactions) > state.budget;
    },

    /**
     * getMonthlyTotal(transactions) → number
     * Sums transaction amounts for the current calendar month.
     * @param {Array} transactions
     */
    getMonthlyTotal(transactions) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      return transactions
        .filter(tx => {
          const d = new Date(tx.timestamp);
          return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
        })
        .reduce((sum, tx) => sum + tx.amount, 0);
    },
  };

  /* ============================================================
     SECTION 5 — ChartRenderer
     Renders and updates the Chart.js doughnut chart.
     ============================================================ */

  const ChartRenderer = {
    _chart: null,
    _canvasEl: null,

    /**
     * init(canvasEl) → void
     * Creates the Chart.js doughnut instance.
     * Handles CDN load failure gracefully.
     * @param {HTMLCanvasElement} canvasEl
     */
    init(canvasEl) {
      this._canvasEl = canvasEl;

      // Handle Chart.js CDN load failure (Requirement 8, design error handling)
      if (typeof window.Chart === 'undefined') {
        const errorEl = document.getElementById('chart-error');
        if (errorEl) {
          errorEl.hidden = false;
        }
        if (canvasEl) {
          canvasEl.hidden = true;
        }
        return;
      }

      const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

      // Center "No data" text plugin (Requirement 8.6)
      const centerTextPlugin = {
        id: 'centerText',
        afterDraw(chart) {
          if (!chart._showEmpty) return;
          const { ctx, chartArea } = chart;
          if (!chartArea) return;
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top + chartArea.bottom) / 2;
          ctx.save();
          ctx.font = 'bold 16px sans-serif';
          ctx.fillStyle = '#9ca3af';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('No data', cx, cy);
          ctx.restore();
        },
      };

      this._chart = new window.Chart(canvasEl, {
        type: 'doughnut',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: [],
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: 'bottom', // Requirement 8.5
            },
            tooltip: {
              // Requirement 8.2: tooltip shows category name, total amount, percentage
              callbacks: {
                label(context) {
                  const label = context.label || '';
                  const value = context.parsed;
                  const total = context.dataset.data.reduce((sum, v) => sum + v, 0);
                  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                  const formatted = formatter.format(value);
                  return `${label}: ${formatted} (${pct}%)`;
                },
              },
            },
          },
        },
        plugins: [centerTextPlugin],
      });

      // Show empty state on initial render
      this.showEmpty();
    },

    /**
     * update(transactions) → void
     * Groups amounts by category and animates chart data update.
     * @param {Array} transactions
     */
    update(transactions) {
      if (!this._chart) return;

      if (!transactions || transactions.length === 0) {
        this.showEmpty();
        return;
      }

      // Group amounts by category (Requirement 8.1, Property 17)
      const totals = {};
      for (const tx of transactions) {
        totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
      }

      const labels = Object.keys(totals);
      const data = labels.map(cat => totals[cat]);
      const colors = labels.map(cat => CategoryManager.getCategoryColor(cat)); // Requirement 8.4

      this._chart._showEmpty = false;
      this._chart.data.labels = labels;
      this._chart.data.datasets[0].data = data;
      this._chart.data.datasets[0].backgroundColor = colors;
      this._chart.data.datasets[0].borderWidth = 2;

      this._chart.update(); // Requirement 8.3: animate smooth update
    },

    /**
     * showEmpty() → void
     * Displays a grayed-out placeholder with "No data" center text.
     * Requirement 8.6
     */
    showEmpty() {
      if (!this._chart) return;

      this._chart._showEmpty = true;
      this._chart.data.labels = ['No data'];
      this._chart.data.datasets[0].data = [1];
      this._chart.data.datasets[0].backgroundColor = ['#d1d5db'];
      this._chart.data.datasets[0].borderWidth = 0;

      this._chart.update();
    },
  };

  /* ============================================================
     SECTION 6 — TransactionList
     Renders transaction cards with sort/filter controls.
     ============================================================ */

  const TransactionList = {
    /**
     * render(transactions, sortBy, filterCategory) → void
     * Applies filter + sort, then renders transaction cards.
     * Shows empty-state message when list is empty.
     * @param {Array}  transactions
     * @param {string} sortBy          'newest' | 'highest'
     * @param {string} filterCategory  'all' | category name
     */
    render(transactions, sortBy, filterCategory) {
      const listEl = document.getElementById('transaction-list');
      if (!listEl) return;

      // Filter — do not mutate original array
      let filtered = filterCategory !== 'all'
        ? transactions.filter(tx => tx.category === filterCategory)
        : transactions.slice();

      // Sort
      if (sortBy === 'highest') {
        filtered = filtered.slice().sort((a, b) => b.amount - a.amount);
      } else {
        // 'newest' — sort by timestamp descending
        filtered = filtered.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }

      // Clear current content
      listEl.innerHTML = '';

      if (filtered.length === 0) {
        const li = document.createElement('li');
        li.className = 'transaction-empty';
        li.textContent = 'No expenses yet. Add one above!';
        listEl.appendChild(li);
        return;
      }

      const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

      for (const tx of filtered) {
        const color = CategoryManager.getCategoryColor(tx.category);
        const formattedAmount = formatter.format(tx.amount);
        const formattedDate = new Date(tx.timestamp).toLocaleString();

        const li = document.createElement('li');
        li.className = 'transaction-card';
        li.dataset.id = tx.id;

        li.innerHTML = `
          <div class="transaction-info">
            <span class="transaction-name">${escapeHtml(tx.name)}</span>
            <span class="transaction-amount">${formattedAmount}</span>
          </div>
          <div class="transaction-meta">
            <span class="transaction-badge" style="background-color:${color}">${escapeHtml(tx.category)}</span>
            <span class="transaction-date">${formattedDate}</span>
          </div>
          <button class="btn-delete" aria-label="Delete expense" title="Delete expense" data-id="${tx.id}">🗑</button>
        `;

        li.querySelector('.btn-delete').addEventListener('click', () => {
          TransactionStore.remove(tx.id);
          ToastController.show('Expense deleted', 3000);
        });

        listEl.appendChild(li);
      }
    },

    /**
     * getSortOrder() → 'newest' | 'highest'
     * Reads the current value of the sort <select>.
     */
    getSortOrder() {
      const el = document.getElementById('sort-select');
      return el ? el.value : 'newest';
    },

    /**
     * getFilter() → string
     * Reads the current value of the filter <select>.
     */
    getFilter() {
      const el = document.getElementById('filter-select');
      return el ? el.value : 'all';
    },

    /**
     * init() → void
     * Wires sort and filter change events to call renderAll().
     */
    init() {
      const sortEl   = document.getElementById('sort-select');
      const filterEl = document.getElementById('filter-select');
      if (sortEl)   sortEl.addEventListener('change',   () => renderAll());
      if (filterEl) filterEl.addEventListener('change', () => renderAll());
    },
  };

  /**
   * escapeHtml(str) → string
   * Escapes HTML special characters to prevent XSS.
   * @param {string} str
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ============================================================
     SECTION 7 — MonthlySummary
     Renders the monthly spending summary and progress bar.
     ============================================================ */

  const MonthlySummary = {
    /**
     * render(transactions, budget) → void
     * Filters to current month, sums amounts, renders summary
     * and progress bar (green under budget, red at/over budget).
     * Shows a prompt when no budget is set.
     * @param {Array}        transactions
     * @param {number|null}  budget
     */
    render(transactions, budget) {},
  };

  /* ============================================================
     SECTION 8 — ToastController
     Displays brief, non-blocking notification messages.
     ============================================================ */

  const ToastController = {
    /**
     * show(message, durationMs) → void
     * Creates and appends a toast element; auto-removes after duration.
     * @param {string} message
     * @param {number} durationMs
     */
    show(message, durationMs) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;

      const container = document.getElementById('toast-container') || document.body;
      container.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
      }, durationMs);
    },
  };

  /* ============================================================
     SECTION 9 — ThemeController
     Applies and persists the light/dark theme preference.
     localStorage key: ebv_theme
     ============================================================ */

  const ThemeController = {
    /**
     * init() → void
     * Reads ebv_theme from localStorage and applies it (defaults to light).
     */
    init() {},

    /**
     * toggle() → void
     * Switches between light and dark themes and persists the choice.
     */
    toggle() {},

    /**
     * apply(theme) → void
     * Sets data-theme on <html> and updates the toggle button icon.
     * Sun icon shown in dark mode; moon icon shown in light mode.
     * @param {'light'|'dark'} theme
     */
    apply(theme) {},
  };

  /* ============================================================
     SECTION 10 — renderAll
     Single render pass called after every state mutation.
     Preserves current sort/filter selections.
     ============================================================ */

  /**
   * renderAll() → void
   * Re-renders TransactionList, ChartRenderer, MonthlySummary,
   * and the Total Spent metric in one pass.
   */
  function renderAll() {
    const transactions = state.transactions;

    // ── Total Spent metric (Requirements 6.1, 6.2, 6.3, 6.4) ──
    const totalSpentEl   = document.getElementById('total-spent');
    const budgetWarningEl = document.getElementById('budget-warning');

    if (totalSpentEl) {
      const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
      const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
      totalSpentEl.textContent = formatter.format(total);

      const overBudget = BudgetManager.isOverBudget(transactions);
      if (overBudget) {
        totalSpentEl.classList.add('over-budget');
      } else {
        totalSpentEl.classList.remove('over-budget');
      }

      if (budgetWarningEl) {
        budgetWarningEl.hidden = !overBudget;
      }
    }

    // ── Transaction List ──
    TransactionList.render(transactions, TransactionList.getSortOrder(), TransactionList.getFilter());

    // ── Chart ──
    ChartRenderer.update(transactions);

    // ── Monthly Summary ──
    MonthlySummary.render(transactions, state.budget);
  }

  /* ============================================================
     SECTION 11 — App Initialization
     Entry point: load persisted data, wire event listeners,
     and perform the initial render.
     ============================================================ */

  function init() {
    // Load persisted transactions into state
    state.transactions = TransactionStore.getData();

    // Wire Validator input listeners so errors clear on correction
    Validator.initClearOnInput();

    // Load and populate categories
    CategoryManager.loadCategories();
    CategoryManager.populateDropdowns();
    CategoryManager.initEvents();

    // Load persisted budget into state
    state.budget = BudgetManager.getBudget();

    // Wire budget save button
    const budgetSaveBtn = document.getElementById('budget-save');
    const budgetInput   = document.getElementById('budget-input');
    if (budgetSaveBtn && budgetInput) {
      budgetSaveBtn.addEventListener('click', () => {
        const result = BudgetManager.setBudget(budgetInput.value);
        if (result.ok) {
          renderAll();
        }
      });
      // Clear error on input
      budgetInput.addEventListener('input', () => {
        const errorEl = document.getElementById('budget-error');
        if (errorEl) {
          errorEl.hidden = true;
          errorEl.textContent = '';
        }
      });
    }

    // Initialize chart
    const canvasEl = document.getElementById('spending-chart');
    if (canvasEl) {
      ChartRenderer.init(canvasEl);
    }

    // Wire sort and filter controls
    TransactionList.init();

    // Wire expense form submit handler
    const expenseForm = document.getElementById('expense-form');
    if (expenseForm) {
      expenseForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const nameEl     = document.getElementById('item-name');
        const amountEl   = document.getElementById('item-amount');
        const categoryEl = document.getElementById('item-category');

        const name     = nameEl     ? nameEl.value     : '';
        const amount   = amountEl   ? amountEl.value   : '';
        const category = categoryEl ? categoryEl.value : '';

        const { valid, errors } = Validator.validate(name, amount, category);

        if (!valid) {
          if (errors.name     && nameEl)     Validator.showError(nameEl,     errors.name);
          if (errors.amount   && amountEl)   Validator.showError(amountEl,   errors.amount);
          if (errors.category && categoryEl) Validator.showError(categoryEl, errors.category);
          return;
        }

        const tx = {
          name:      name.trim(),
          amount:    parseFloat(amount),
          category,
          timestamp: new Date().toISOString(),
        };

        TransactionStore.add(tx);

        // Reset form fields
        if (nameEl)     nameEl.value     = '';
        if (amountEl)   amountEl.value   = '';
        if (categoryEl) categoryEl.value = '';

        ToastController.show('Transaction added', 3000);
      });
    }
  }

  // Kick off the app once the DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
