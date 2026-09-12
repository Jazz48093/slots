/**
 * UC 104 PENDING SLOTS - LIVE CLIENT APPLICATION
 * Zero-cache proxy architecture, instant state purging on refresh,
 * 5-column glass card grid & executive table view.
 */

(function () {
  'use strict';

  // Application State
  const state = {
    items: [],
    filteredItems: [],
    currentFilter: 'all',
    searchQuery: '',
    viewMode: 'grid', // 'grid' | 'table'
    hideSlotsOver: false,
    countdown: 20,
    countdownInterval: null,
    isSyncing: false,
    lastSyncTimestamp: null,
  };

  // DOM Elements
  const elements = {
    productGrid: document.getElementById('productGrid'),
    tableViewContainer: document.getElementById('tableViewContainer'),
    executiveTableBody: document.getElementById('executiveTableBody'),
    purgeLoadingView: document.getElementById('purgeLoadingView'),
    emptyState: document.getElementById('emptyState'),
    btnResetFilters: document.getElementById('btnResetFilters'),
    hideSlotsOverCheckbox: document.getElementById('hideSlotsOverCheckbox'),
    
    // Header & Controls
    searchInput: document.getElementById('searchInput'),
    searchClearBtn: document.getElementById('searchClearBtn'),
    btnSyncNow: document.getElementById('btnSyncNow'),
    syncIcon: document.getElementById('syncIcon'),
    countdownSeconds: document.getElementById('countdownSeconds'),
    lastSyncTime: document.getElementById('lastSyncTime'),
    
    // View Switcher
    btnViewGrid: document.getElementById('btnViewGrid'),
    btnViewTable: document.getElementById('btnViewTable'),
    
    // Filter Tabs
    filterTabs: document.querySelectorAll('.filter-tab'),
    countAll: document.getElementById('countAll'),
    countAvailable: document.getElementById('countAvailable'),
    countLow: document.getElementById('countLow'),
    countOver: document.getElementById('countOver'),
    
    // KPI Cards
    kpiTotalSkus: document.getElementById('kpiTotalSkus'),
    kpiTotalTarget: document.getElementById('kpiTotalTarget'),
    kpiTotalDone: document.getElementById('kpiTotalDone'),
    kpiTotalRemaining: document.getElementById('kpiTotalRemaining'),
    kpiActiveDiscounts: document.getElementById('kpiActiveDiscounts'),
    kpiPercent: document.getElementById('kpiPercent'),
    
    toastContainer: document.getElementById('toastContainer'),
  };

  /**
   * Evaluates slot count and produces user-defined badge, text, and disabled status.
   * Rules:
   *  - > 3: "More than 3 orders remaining"
   *  - 3: "3 orders left"
   *  - 2: "2 orders left"
   *  - 1: "1 order left"
   *  - 0: "No slots left"
   *  - < 0: "No slots left" (Product disabled & link disabled)
   */
  function getSlotStatus(remaining) {
    if (remaining > 3) {
      return {
        label: 'More than 3 slots remaining',
        badgeClass: 'slot-badge-available',
        remClass: '',
        isDisabled: false,
        category: 'available',
      };
    } else if (remaining === 3) {
      return {
        label: '3 slots left',
        badgeClass: 'slot-badge-three',
        remClass: 'rem-val-low',
        isDisabled: false,
        category: 'low',
      };
    } else if (remaining === 2) {
      return {
        label: '2 slots left',
        badgeClass: 'slot-badge-low',
        remClass: 'rem-val-low',
        isDisabled: false,
        category: 'low',
      };
    } else if (remaining === 1) {
      return {
        label: '1 slot left',
        badgeClass: 'slot-badge-low',
        remClass: 'rem-val-low',
        isDisabled: false,
        category: 'low',
      };
    } else if (remaining === 0) {
      return {
        label: 'No slots left',
        badgeClass: 'slot-badge-zero',
        remClass: '',
        isDisabled: true,
        category: 'over',
      };
    } else {
      // remaining < 0
      return {
        label: 'No slots left',
        badgeClass: 'slot-badge-disabled',
        remClass: 'rem-val-negative',
        isDisabled: true,
        category: 'over',
      };
    }
  }

  /**
   * Shows a sleek temporary toast notification
   */
  function showToast(message, icon = '✓') {
    if (!elements.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 300ms ease, transform 300ms ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  /**
   * Purges all existing data from state & DOM
   */
  function purgeExistingData() {
    state.items = [];
    state.filteredItems = [];
    elements.productGrid.innerHTML = '';
    elements.executiveTableBody.innerHTML = '';
    elements.purgeLoadingView.classList.add('active');
    elements.emptyState.style.display = 'none';
    if (elements.syncIcon) {
      elements.syncIcon.classList.add('spin-anim');
    }
  }

  /**
   * Main fetch method: Queries /api/data with cache-busting timestamp,
   * falling back directly to Google Sheets CSV export if needed.
   */
  async function fetchLiveData(isAutoRefresh = false) {
    if (state.isSyncing) return;
    state.isSyncing = true;
    
    // Purge existing data before loading fresh data
    purgeExistingData();

    const timestamp = Date.now();
    let loadedItems = [];

    try {
      // 1. Try Zero-Cache Proxy Endpoint
      const response = await fetch(`/api/data?_nocache=${timestamp}`, {
        cache: 'no-store',
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.items) {
          loadedItems = data.items;
        }
      } else {
        throw new Error(`Server proxy error: ${response.status}`);
      }
    } catch (err) {
      console.warn('Proxy request failed, falling back to direct sheet fetch:', err);
      // 2. Direct Fallback to Google Sheets CSV export
      try {
        const directUrl = `https://docs.google.com/spreadsheets/d/e/2PACX-1vRqiAXWRcgtm3Au4vvNJqdY427P0dqyf0nuF_Z7xoaKWOYgN4ESKPdUFM1UzPYJRYealThYL6M0z0ll/pub?gid=1705723818&single=true&output=csv&_nocache=${timestamp}`;
        const fallbackResp = await fetch(directUrl, { cache: 'no-store' });
        if (fallbackResp.ok) {
          const csvText = await fallbackResp.text();
          loadedItems = parseCsvFallback(csvText);
        }
      } catch (fbErr) {
        console.error('All fetch methods failed:', fbErr);
        showToast('Error syncing data. Retrying...', '⚠️');
      }
    } finally {
      state.isSyncing = false;
      elements.purgeLoadingView.classList.remove('active');
      if (elements.syncIcon) {
        elements.syncIcon.classList.remove('spin-anim');
      }

      state.items = loadedItems;
      state.lastSyncTimestamp = new Date();
      updateLastSyncText();
      
      // Update KPIs, filters and render views
      calculateKpis();
      applyFiltersAndRender();
      resetCountdown();

      if (!isAutoRefresh) {
        showToast(`Refreshed ${state.items.length} items live from sheet!`);
      }
    }
  }

  /**
   * Fallback CSV parser for direct sheet fetches
   */
  function parseCsvFallback(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim());
    if (lines.length <= 1) return [];

    const items = [];
    for (let i = 1; i < lines.length; i++) {
      // Basic CSV field parser supporting quotes
      const row = parseCsvRow(lines[i]);
      if (!row || row.length < 2) continue;

      const name = (row[0] || '').trim();
      const asin = (row[1] || '').trim();
      const link = (row[2] || '').trim();
      const qty = parseInt(row[3], 10) || 0;
      const done = parseInt(row[4], 10) || 0;
      const remaining = parseInt(row[5], 10) || 0;
      const lessRaw = (row[6] || '').trim();
      
      const less = (!lessRaw || lessRaw === '--' || lessRaw === '-' || lessRaw === '0%') ? '-' : lessRaw;

      if (!name && !asin) continue;

      items.push({
        name,
        asin,
        link,
        qty,
        done,
        remaining,
        less,
        image: ''
      });
    }
    return items;
  }

  function parseCsvRow(text) {
    const p = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        p.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    p.push(cur);
    return p.map(s => s.replace(/^"|"$/g, '').trim());
  }

  /**
   * Calculate executive KPIs across current dataset
   */
  function calculateKpis() {
    const totalSkus = state.items.length;
    let availableCount = 0;
    let lowCount = 0;
    let overCount = 0;

    state.items.forEach(item => {
      const status = getSlotStatus(item.remaining);
      if (status.category === 'available') availableCount++;
      else if (status.category === 'low') lowCount++;
      else if (status.category === 'over') overCount++;
    });

    // Update tab counts
    if (elements.countAll) elements.countAll.textContent = totalSkus;
    if (elements.countAvailable) elements.countAvailable.textContent = availableCount;
    if (elements.countLow) elements.countLow.textContent = lowCount;
    if (elements.countOver) elements.countOver.textContent = overCount;
  }

  /**
   * Filter items by tab category & instant search query
   */
  function applyFiltersAndRender() {
    const query = state.searchQuery.toLowerCase().trim();
    const filter = state.currentFilter;
    const hideOver = state.hideSlotsOver;

    state.filteredItems = state.items.filter(item => {
      const status = getSlotStatus(item.remaining);

      // Option: Hide 'slots over' products (remaining <= 0)
      if (hideOver && status.category === 'over' && filter !== 'over') {
        return false;
      }

      // Tab Category filter
      if (filter === 'available' && status.category !== 'available') return false;
      if (filter === 'low' && status.category !== 'low') return false;
      if (filter === 'over' && status.category !== 'over') return false;

      // Text search filter
      if (query) {
        const nameMatch = (item.name || '').toLowerCase().includes(query);
        const asinMatch = (item.asin || '').toLowerCase().includes(query);
        const lessMatch = (item.less || '').toLowerCase().includes(query);
        return nameMatch || asinMatch || lessMatch;
      }

      return true;
    });

    renderCurrentView();
  }

  /**
   * Render either the 6-column Card Grid or the Executive Table
   */
  function renderCurrentView() {
    const count = state.filteredItems.length;

    if (count === 0) {
      elements.productGrid.style.display = 'none';
      elements.tableViewContainer.style.display = 'none';
      elements.emptyState.style.display = 'flex';
      return;
    }

    elements.emptyState.style.display = 'none';

    if (state.viewMode === 'grid') {
      elements.productGrid.style.display = 'grid';
      elements.tableViewContainer.style.display = 'none';
      renderGrid();
    } else {
      elements.productGrid.style.display = 'none';
      elements.tableViewContainer.style.display = 'block';
      renderTable();
    }
  }

  /**
   * Render 6-column Product Showcase Grid
   */
  function renderGrid() {
    const html = state.filteredItems.map(item => {
      const status = getSlotStatus(item.remaining);
      const cardDisabledClass = status.isDisabled ? 'is-disabled' : '';

      // Clean image with fallback
      const imageUrl = item.image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="%2394A3B8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

      return `
        <div class="product-card glass-panel ${cardDisabledClass}">
          <!-- Image Chamber (No ASIN) -->
          <div class="product-image-box">
            <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" class="product-img" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'160\\' height=\\'160\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23cbd5e1\\' stroke-width=\\'1.5\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'3\\'/><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'/><path d=\\'M21 15l-5-5L5 21\\'/></svg>';">
          </div>

          <!-- Body -->
          <div class="card-body">
            <h3 class="product-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h3>

            <!-- Slot Status Badge -->
            <div class="slot-badge ${status.badgeClass}">
              <span>${status.label}</span>
            </div>

            <!-- Less % -->
            <div class="card-less-box">
              <span class="card-less-label">Less %</span>
              <span class="card-less-val">${escapeHtml(item.less || '-')}</span>
            </div>

            <!-- Small Centered Glass Pill Button -->
            ${item.link && !status.isDisabled ? `
              <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="btn-product-link-small" title="Open product listing on Amazon">
                <span>View Link</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </a>
            ` : `
              <button class="btn-product-link-small is-disabled" disabled title="Slots are over or inactive">
                <span>⛔ Slot Over</span>
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    elements.productGrid.innerHTML = html;
  }

  /**
   * Render Full Executive Table View (Without Target, Done, or ASIN)
   */
  function renderTable() {
    const html = state.filteredItems.map(item => {
      const status = getSlotStatus(item.remaining);
      const rowDisabled = status.isDisabled ? 'is-disabled' : '';
      const imageUrl = item.image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';

      return `
        <tr class="${rowDisabled}">
          <td>
            <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" class="table-thumb" loading="lazy">
          </td>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
          </td>
          <td style="text-align: center;">
            <span class="slot-badge ${status.badgeClass}" style="margin: 0; padding: 4px 12px; font-size: 0.72rem; width: auto; display: inline-flex;">${status.label}</span>
          </td>
          <td style="text-align: center; font-weight: 700; color: var(--secondary-accent); font-size: 0.85rem;">
            ${escapeHtml(item.less || '-')}
          </td>
          <td style="text-align: center;">
            ${item.link && !status.isDisabled ? `
              <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="btn-product-link-small" style="padding: 4px 12px; font-size: 0.7rem;">
                <span>Link</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </a>
            ` : `
              <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">Disabled</span>
            `}
          </td>
        </tr>
      `;
    }).join('');

    elements.executiveTableBody.innerHTML = html;
  }

  /**
   * 20-second countdown cycle
   */
  function resetCountdown() {
    clearInterval(state.countdownInterval);
    state.countdown = 20;
    updateCountdownDisplay();

    state.countdownInterval = setInterval(() => {
      state.countdown--;
      updateCountdownDisplay();

      if (state.countdown <= 0) {
        fetchLiveData(true);
      }
    }, 1000);
  }

  function updateCountdownDisplay() {
    if (elements.countdownSeconds) {
      elements.countdownSeconds.textContent = `${state.countdown}s`;
    }
  }

  function updateLastSyncText() {
    if (!elements.lastSyncTime) return;
    if (!state.lastSyncTimestamp) {
      elements.lastSyncTime.textContent = 'Connecting...';
      return;
    }
    const timeStr = state.lastSyncTimestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    elements.lastSyncTime.textContent = `Last synced at ${timeStr}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Event Handlers Setup
   */
  function setupEventListeners() {
    // Manual Sync Button
    elements.btnSyncNow.addEventListener('click', () => {
      fetchLiveData(false);
    });

    // Instant Search
    elements.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      elements.searchClearBtn.style.display = state.searchQuery ? 'flex' : 'none';
      applyFiltersAndRender();
    });

    // Clear Search Button
    elements.searchClearBtn.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.searchQuery = '';
      elements.searchClearBtn.style.display = 'none';
      elements.searchInput.focus();
      applyFiltersAndRender();
    });

    // Reset Filters from Empty State
    elements.btnResetFilters.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.searchQuery = '';
      elements.searchClearBtn.style.display = 'none';
      if (elements.hideSlotsOverCheckbox) {
        elements.hideSlotsOverCheckbox.checked = false;
        state.hideSlotsOver = false;
      }
      setActiveFilter('all');
    });

    // Hide Slots Over Toggle Switch
    if (elements.hideSlotsOverCheckbox) {
      elements.hideSlotsOverCheckbox.addEventListener('change', (e) => {
        state.hideSlotsOver = e.target.checked;
        applyFiltersAndRender();
        showToast(state.hideSlotsOver ? 'Hiding "slots over" products' : 'Showing all slot states');
      });
    }

    // Filter Tabs
    elements.filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const filter = tab.dataset.filter;
        setActiveFilter(filter);
      });
    });

    // View Switcher Buttons
    elements.btnViewGrid.addEventListener('click', () => {
      setViewMode('grid');
    });

    elements.btnViewTable.addEventListener('click', () => {
      setViewMode('table');
    });

    // Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== elements.searchInput) {
        e.preventDefault();
        elements.searchInput.focus();
      } else if (e.key === 'Escape' && document.activeElement === elements.searchInput) {
        elements.searchInput.value = '';
        state.searchQuery = '';
        elements.searchClearBtn.style.display = 'none';
        elements.searchInput.blur();
        applyFiltersAndRender();
      } else if ((e.key === 'r' || e.key === 'R') && document.activeElement !== elements.searchInput) {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          fetchLiveData(false);
        }
      }
    });
  }

  function setActiveFilter(filter) {
    state.currentFilter = filter;
    elements.filterTabs.forEach(t => {
      t.classList.toggle('active', t.dataset.filter === filter);
    });
    applyFiltersAndRender();
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    elements.btnViewGrid.classList.toggle('active', mode === 'grid');
    elements.btnViewGrid.setAttribute('aria-pressed', mode === 'grid');
    elements.btnViewTable.classList.toggle('active', mode === 'table');
    elements.btnViewTable.setAttribute('aria-pressed', mode === 'table');
    renderCurrentView();
  }

  // Initialization
  setupEventListeners();
  fetchLiveData(true);

})();
