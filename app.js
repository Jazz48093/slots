/**
 * SLOTS LIVE COUNTER - MULTI-BRAND APPLICATION
 * Real-time order targets, fulfilled quantities, and remaining slots
 * with Brand grouping, zero-cache live proxy, and instant state sync.
 */

(function () {
  'use strict';

  // Application State
  const state = {
    items: [],
    brands: [], // Preserves Google Sheet order
    stats: null,
    filteredItems: [],
    currentBrand: 'all',
    currentFilter: 'all',
    searchQuery: '',
    showSlotsOver: true, // Show all products by default so newly added items are never hidden
    countdown: 30,
    countdownInterval: null,
    isSyncing: false,
    isRefreshingImages: false,
    resolvingAsins: new Set(),
    lastSyncTimestamp: null,
  };

  // DOM Elements
  const elements = {
    productGridContainer: document.getElementById('productGridContainer'),
    productGrid: document.getElementById('productGrid'),
    purgeLoadingView: document.getElementById('purgeLoadingView'),
    emptyState: document.getElementById('emptyState'),
    btnResetFilters: document.getElementById('btnResetFilters'),
    showSlotsOverCheckbox: document.getElementById('showSlotsOverCheckbox'),
    hideSlotsTooltip: document.getElementById('hideSlotsTooltip'),
    
    // Header & Controls
    searchInput: document.getElementById('searchInput'),
    searchClearBtn: document.getElementById('searchClearBtn'),
    btnSyncNow: document.getElementById('btnSyncNow'),
    btnSyncText: document.getElementById('btnSyncText'),
    syncIcon: document.getElementById('syncIcon'),
    btnQuickRefresh: document.getElementById('btnQuickRefresh'),
    countdownBadge: document.getElementById('countdownBadge'),
    btnRefreshImages: document.getElementById('btnRefreshImages'),
    refreshImagesIcon: document.getElementById('refreshImagesIcon'),
    countdownSeconds: document.getElementById('countdownSeconds'),
    lastSyncTime: document.getElementById('lastSyncTime'),
    
    // KPI Cards
    kpiTotalBrands: document.getElementById('kpiTotalBrands'),
    kpiTotalSkus: document.getElementById('kpiTotalSkus'),
    kpiTotalTarget: document.getElementById('kpiTotalTarget'),
    kpiTotalDone: document.getElementById('kpiTotalDone'),
    kpiTotalRemaining: document.getElementById('kpiTotalRemaining'),
    kpiPercent: document.getElementById('kpiPercent'),
    
    // Brand Chips
    btnBrandAll: document.getElementById('btnBrandAll'),
    countBrandAll: document.getElementById('countBrandAll'),
    dynamicBrandChips: document.getElementById('dynamicBrandChips'),

    // Filter Tabs
    filterTabs: document.querySelectorAll('.filter-tab'),
    countAll: document.getElementById('countAll'),
    countAvailable: document.getElementById('countAvailable'),
    countLow: document.getElementById('countLow'),
    countOver: document.getElementById('countOver'),
    
    toastContainer: document.getElementById('toastContainer'),
  };

  /**
   * Evaluates slot count and produces user-defined badge, text, and disabled status.
   * Rules:
   *  - > 3: "3+ slots left"
   *  - 3: "3 slots left"
   *  - 2: "2 slots left"
   *  - 1: "1 slot left"
   *  - 0: "No slots left"
   *  - < 0: "No slots left" (Product disabled & link disabled)
   */
  function getSlotStatus(remaining) {
    if (remaining > 3) {
      return {
        label: `${remaining} slots left`,
        badgeClass: 'slot-badge-available',
        remClass: 'val-green',
        isDisabled: false,
        category: 'available',
      };
    } else if (remaining === 3) {
      return {
        label: '3 slots left',
        badgeClass: 'slot-badge-three',
        remClass: 'val-low',
        isDisabled: false,
        category: 'low',
      };
    } else if (remaining === 2) {
      return {
        label: '2 slots left',
        badgeClass: 'slot-badge-low',
        remClass: 'val-low',
        isDisabled: false,
        category: 'low',
      };
    } else if (remaining === 1) {
      return {
        label: '1 slot left',
        badgeClass: 'slot-badge-low',
        remClass: 'val-low',
        isDisabled: false,
        category: 'low',
      };
    } else if (remaining === 0) {
      return {
        label: 'No slots left',
        badgeClass: 'slot-badge-zero',
        remClass: 'val-zero',
        isDisabled: true,
        category: 'over',
      };
    } else {
      // remaining < 0
      return {
        label: 'No slots left',
        badgeClass: 'slot-badge-disabled',
        remClass: 'val-zero',
        isDisabled: true,
        category: 'over',
      };
    }
  }

  /**
   * Escape HTML utility to prevent XSS injection
   */
  function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Toast Notification Helper
   */
  function showToast(message, type = 'info') {
    if (!elements.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;
    toast.innerHTML = `
      <div class="toast-body">
        <span>${escapeHtml(message)}</span>
      </div>
    `;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  /**
   * Fetch Live Data from Proxy API with aggressive cache-busting
   */
  async function fetchLiveData(isManual = false) {
    if (state.isSyncing) return;
    state.isSyncing = true;

    const quickRefreshIcon = document.querySelector('.quick-refresh-icon');

    if (elements.syncIcon) elements.syncIcon.classList.add('is-spinning');
    if (quickRefreshIcon) quickRefreshIcon.classList.add('is-spinning');
    if (elements.btnSyncText) elements.btnSyncText.textContent = 'Refreshing...';
    if (elements.lastSyncTime) elements.lastSyncTime.textContent = 'Syncing...';

    // Show purge animation on initial load or manual refresh
    if (state.items.length === 0 || isManual) {
      if (elements.purgeLoadingView) elements.purgeLoadingView.style.display = 'flex';
      if (elements.productGridContainer) elements.productGridContainer.style.display = 'none';
      if (elements.emptyState) elements.emptyState.style.display = 'none';
    }

    try {
      const ts = Date.now();
      const url = `/api/data?_nocache=${ts}&_t=${ts}`;
      const res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Expires': '0'
        }
      });

      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();

      if (data.status === 'success') {
        state.items = data.items || [];
        state.brands = data.brands || []; // In Google Sheet order
        state.stats = data.stats || null;
        state.lastSyncTimestamp = Date.now();

        updateKpiMetrics();
        renderBrandChips();
        updateTabCounts();
        applyFiltersAndRender();

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (elements.lastSyncTime) elements.lastSyncTime.textContent = `Synced: ${timeStr}`;

        if (isManual) {
          showToast(`✓ Real-time sync complete: ${state.items.length} items loaded!`, 'success');
        }
      } else {
        throw new Error(data.message || 'API error');
      }
    } catch (err) {
      console.error('Data fetch error:', err);
      if (elements.lastSyncTime) elements.lastSyncTime.textContent = 'Sync Failed';
      showToast(`Sync Failed: ${err.message}`, 'error');
    } finally {
      state.isSyncing = false;
      if (elements.syncIcon) elements.syncIcon.classList.remove('is-spinning');
      if (quickRefreshIcon) quickRefreshIcon.classList.remove('is-spinning');
      if (elements.btnSyncText) elements.btnSyncText.textContent = 'Refresh Live';
      if (elements.purgeLoadingView) elements.purgeLoadingView.style.display = 'none';
      if (elements.productGridContainer) elements.productGridContainer.style.display = 'block';
      resetCountdown();
    }
  }

  /**
   * Update Executive KPI metrics
   */
  function updateKpiMetrics() {
    const totalBrands = state.brands.length;
    const totalSkus = state.items.length;
    const totalTarget = state.items.reduce((acc, it) => acc + (it.qty || 0), 0);
    const totalDone = state.items.reduce((acc, it) => acc + (it.done || 0), 0);
    const totalRemaining = state.items.reduce((acc, it) => acc + (it.remaining || 0), 0);
    const percentDone = totalTarget > 0 ? Math.round((totalDone / totalTarget) * 100) : 0;

    if (elements.kpiTotalBrands) elements.kpiTotalBrands.textContent = totalBrands;
    if (elements.kpiTotalSkus) elements.kpiTotalSkus.textContent = totalSkus;
    if (elements.kpiTotalTarget) elements.kpiTotalTarget.textContent = totalTarget.toLocaleString();
    if (elements.kpiTotalDone) elements.kpiTotalDone.textContent = totalDone.toLocaleString();
    if (elements.kpiTotalRemaining) elements.kpiTotalRemaining.textContent = totalRemaining.toLocaleString();
    if (elements.kpiPercent) elements.kpiPercent.textContent = `${percentDone}% Done`;
  }

  /**
   * Render Multi-Brand Filter Chips in Google Sheet Order
   */
  function renderBrandChips() {
    if (elements.countBrandAll) elements.countBrandAll.textContent = state.items.length;
    if (!elements.dynamicBrandChips) return;

    const brandCounts = {};
    state.items.forEach(it => {
      const b = it.brand || 'General';
      brandCounts[b] = (brandCounts[b] || 0) + 1;
    });

    // state.brands preserves insertion order from the Google Sheet!
    const html = state.brands.map(brand => {
      const count = brandCounts[brand] || 0;
      const isActive = state.currentBrand === brand ? 'active' : '';
      return `
        <button class="brand-chip-btn ${isActive}" data-brand="${escapeHtml(brand)}">
          <span>${escapeHtml(brand)}</span>
          <span class="chip-count">${count}</span>
        </button>
      `;
    }).join('');

    elements.dynamicBrandChips.innerHTML = html;

    // Attach click events
    elements.dynamicBrandChips.querySelectorAll('.brand-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const brand = btn.dataset.brand;
        setBrandFilter(brand);
      });
    });
  }

  function setBrandFilter(brand) {
    state.currentBrand = brand;
    if (elements.btnBrandAll) {
      elements.btnBrandAll.classList.toggle('active', brand === 'all');
    }
    if (elements.dynamicBrandChips) {
      elements.dynamicBrandChips.querySelectorAll('.brand-chip-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.brand === brand);
      });
    }
    applyFiltersAndRender();

    // Scroll to brand section if in multi-brand view
    if (brand !== 'all') {
      const section = document.getElementById(`brand-group-${encodeURIComponent(brand)}`);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  /**
   * Update Filter Tab Counts
   */
  function updateTabCounts() {
    let availCount = 0;
    let lowCount = 0;
    let overCount = 0;

    // Count tabs relative to current brand selection
    const relevantItems = state.currentBrand === 'all'
      ? state.items
      : state.items.filter(it => it.brand === state.currentBrand);

    relevantItems.forEach(item => {
      const status = getSlotStatus(item.remaining);
      if (status.category === 'available') availCount++;
      else if (status.category === 'low') lowCount++;
      else if (status.category === 'over') overCount++;
    });

    if (elements.countAll) elements.countAll.textContent = relevantItems.length;
    if (elements.countAvailable) elements.countAvailable.textContent = availCount;
    if (elements.countLow) elements.countLow.textContent = lowCount;
    if (elements.countOver) elements.countOver.textContent = overCount;
  }

  /**
   * Filter items by brand, category tab & search query
   */
  function applyFiltersAndRender() {
    const query = state.searchQuery.toLowerCase().trim();
    const filter = state.currentFilter;
    const showOver = state.showSlotsOver;
    const brand = state.currentBrand;

    state.filteredItems = state.items.filter(item => {
      // 1. Brand Filter
      if (brand !== 'all' && item.brand !== brand) {
        return false;
      }

      const status = getSlotStatus(item.remaining);

      // 2. Hide completed slots only if user explicitly toggles switch off AND not on 'over' tab
      if (!showOver && status.category === 'over' && filter !== 'over' && filter !== 'all') {
        return false;
      }

      // 3. Status Tab Filter
      if (filter === 'available' && status.category !== 'available') return false;
      if (filter === 'low' && status.category !== 'low') return false;
      if (filter === 'over' && status.category !== 'over') return false;

      // 4. Search Filter (Brand, SKU Name, ASIN)
      if (query) {
        const brandMatch = (item.brand || '').toLowerCase().includes(query);
        const nameMatch = (item.name || '').toLowerCase().includes(query);
        const asinMatch = (item.asin || '').toLowerCase().includes(query);
        return brandMatch || nameMatch || asinMatch;
      }

      return true;
    });

    renderCurrentView();
  }

  /**
   * Render either Grouped Brand Sections or Single Brand View
   * Preserves the EXACT natural order from Google Sheets!
   */
  function renderCurrentView() {
    const count = state.filteredItems.length;

    if (count === 0) {
      if (elements.productGridContainer) elements.productGridContainer.style.display = 'none';
      if (elements.emptyState) elements.emptyState.style.display = 'flex';
      return;
    }

    if (elements.emptyState) elements.emptyState.style.display = 'none';
    if (elements.productGridContainer) elements.productGridContainer.style.display = 'block';

    // Group items by brand PRESERVING SHEET ORDER (insertion order)
    const brandOrder = [];
    const grouped = {};
    state.filteredItems.forEach(item => {
      const b = item.brand || 'General';
      if (!grouped[b]) {
        grouped[b] = [];
        brandOrder.push(b);
      }
      grouped[b].push(item);
    });

    // If single brand selected or only one brand in list
    if (brandOrder.length <= 1) {
      const singleBrandName = brandOrder[0] || 'Products';
      const items = grouped[singleBrandName] || [];
      const bTarget = items.reduce((s, it) => s + (it.qty || 0), 0);
      const bDone = items.reduce((s, it) => s + (it.done || 0), 0);
      const bRem = items.reduce((s, it) => s + (it.remaining || 0), 0);

      if (state.currentBrand !== 'all') {
        elements.productGridContainer.innerHTML = `
          <section class="brand-group" id="brand-group-${encodeURIComponent(singleBrandName)}">
            <div class="brand-group-header glass-panel">
              <div class="brand-group-left">
                <div class="brand-group-badge-icon">🏷️</div>
                <h2 class="brand-group-title">${escapeHtml(singleBrandName)}</h2>
                <span class="brand-group-count">${items.length} Products</span>
              </div>
              <div class="brand-group-stats">
                <span class="brand-stat-pill">Target: <strong>${bTarget}</strong></span>
                <span class="brand-stat-pill">Done: <strong>${bDone}</strong></span>
                <span class="brand-stat-pill pill-remaining">Slots Left: <strong>${bRem}</strong></span>
              </div>
            </div>
            <div class="product-grid" id="productGrid" aria-label="Product Showcase Grid">
              ${items.map(renderCardHtml).join('')}
            </div>
          </section>
        `;
      } else {
        elements.productGridContainer.innerHTML = `
          <div class="product-grid" id="productGrid" aria-label="Product Showcase Grid">
            ${items.map(renderCardHtml).join('')}
          </div>
        `;
      }
    } else {
      // Multi-brand view: render stylish brand sections with summary headers in Sheet Order!
      const html = brandOrder.map(bName => {
        const items = grouped[bName];
        const bTarget = items.reduce((s, it) => s + (it.qty || 0), 0);
        const bDone = items.reduce((s, it) => s + (it.done || 0), 0);
        const bRem = items.reduce((s, it) => s + (it.remaining || 0), 0);

        return `
          <section class="brand-group" id="brand-group-${encodeURIComponent(bName)}">
            <div class="brand-group-header glass-panel">
              <div class="brand-group-left">
                <div class="brand-group-badge-icon">🏷️</div>
                <h2 class="brand-group-title">${escapeHtml(bName)}</h2>
                <span class="brand-group-count">${items.length} Products</span>
              </div>
              <div class="brand-group-stats">
                <span class="brand-stat-pill">Target: <strong>${bTarget}</strong></span>
                <span class="brand-stat-pill">Done: <strong>${bDone}</strong></span>
                <span class="brand-stat-pill pill-remaining">Slots Left: <strong>${bRem}</strong></span>
              </div>
            </div>
            <div class="product-grid">
              ${items.map(renderCardHtml).join('')}
            </div>
          </section>
        `;
      }).join('');

      elements.productGridContainer.innerHTML = html;
    }

    attachCardActions();
    resolveMissingImages();
  }

  /**
   * Render individual Product Card HTML
   */
  function renderCardHtml(item) {
    const status = getSlotStatus(item.remaining);
    const cardDisabledClass = status.isDisabled ? 'is-disabled' : '';

    const hasImage = Boolean(item.image);
    const imageUrl = hasImage
      ? item.image
      : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="%2394A3B8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

    const percent = item.qty > 0 ? Math.min(100, Math.round((item.done / item.qty) * 100)) : 0;
    const isDoneFull = percent >= 100;

    const isBlinkit = (item.platform === 'Blinkit') || (item.link && item.link.includes('blinkit.'));
    const isAmazon = (item.platform === 'Amazon') || (item.link && item.link.includes('amazon.'));
    const platformLabel = isBlinkit ? 'Blinkit' : (isAmazon ? 'Amazon' : 'Product');
    const idPrefix = isBlinkit ? 'ID' : (isAmazon ? 'ASIN' : 'ID');

    return `
      <div class="product-card glass-panel ${cardDisabledClass}">
        <!-- Image Chamber -->
        <div class="product-image-box ${!hasImage ? 'is-loading-img' : ''}" data-asin="${escapeHtml(item.asin)}">
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" class="product-img" loading="lazy" data-asin="${escapeHtml(item.asin)}" onerror="window.handleImageError && window.handleImageError(this, '${escapeHtml(item.asin)}')">
        </div>

        <!-- Body -->
        <div class="card-body">
          <!-- Brand & ASIN Row -->
          <div class="card-brand-tag-row">
            <span class="card-brand-tag" title="Brand: ${escapeHtml(item.brand)}">${escapeHtml(item.brand)}</span>
            <span class="card-asin-tag" data-copy-asin="${escapeHtml(item.asin)}" title="Click to copy ${idPrefix}">${idPrefix}: ${escapeHtml(item.asin)}</span>
          </div>

          <!-- Product Title -->
          <h3 class="product-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h3>

          <!-- Slot Status Badge -->
          <div class="slot-badge ${status.badgeClass}">
            <span>${status.label}</span>
          </div>

          <!-- 3-Column Slot Metric Grid: Target | Done | Slots -->
          <div class="card-metrics-grid">
            <div class="card-metric-col" title="Target Units Required">
              <span class="metric-col-lbl">Target</span>
              <span class="metric-col-val">${item.qty}</span>
            </div>
            <div class="card-metric-col" title="Units Ordered / Fulfilled">
              <span class="metric-col-lbl">Done</span>
              <span class="metric-col-val">${item.done}</span>
            </div>
            <div class="card-metric-col" title="Slots Remaining">
              <span class="metric-col-lbl">Left</span>
              <span class="metric-col-val ${status.remClass}">${item.remaining}</span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="card-progress-wrap" title="${percent}% Completed">
            <div class="card-progress-fill ${isDoneFull ? 'done-full' : ''}" style="width: ${percent}%;"></div>
          </div>

          <!-- Action Buttons: View Link & Copy Link -->
          <div class="card-bottom-row no-less-tag">
            ${item.link && !status.isDisabled ? `
              <div class="card-action-btns">
                <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="btn-product-link-small" title="Open product listing on ${platformLabel}">
                  <span>View on ${platformLabel}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                </a>
                <button class="btn-copy-link-small" data-link="${escapeHtml(item.link)}" title="Copy link to clipboard" aria-label="Copy link to clipboard">
                  <svg class="copy-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <svg class="check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </button>
              </div>
            ` : `
              <button class="btn-product-link-small is-disabled" disabled title="Slots are over or inactive">
                <span>⛔ Slot Over</span>
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Attach card interaction listeners (Copy link & Copy ASIN)
   */
  function attachCardActions() {
    // Copy Amazon Link
    document.querySelectorAll('.btn-copy-link-small').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const link = btn.dataset.link;
        if (!link) return;

        try {
          await navigator.clipboard.writeText(link);
          const copyIcon = btn.querySelector('.copy-icon');
          const checkIcon = btn.querySelector('.check-icon');
          if (copyIcon) copyIcon.style.display = 'none';
          if (checkIcon) checkIcon.style.display = 'inline-block';

          showToast('✓ Product link copied to clipboard!', 'success');

          setTimeout(() => {
            if (copyIcon) copyIcon.style.display = 'inline-block';
            if (checkIcon) checkIcon.style.display = 'none';
          }, 2000);
        } catch (err) {
          showToast('Failed to copy link', 'error');
        }
      });
    });

    // Copy ASIN
    document.querySelectorAll('[data-copy-asin]').forEach(tag => {
      tag.addEventListener('click', async (e) => {
        e.stopPropagation();
        const asin = tag.dataset.copyAsin;
        if (!asin) return;

        try {
          await navigator.clipboard.writeText(asin);
          showToast(`✓ Copied ASIN: ${asin}`, 'success');
        } catch (err) {
          showToast('Failed to copy ASIN', 'error');
        }
      });
    });
  }

  /**
   * Asynchronously resolves missing images from /api/asin-image
   */
  async function resolveMissingImages() {
    const missingBoxes = document.querySelectorAll('.product-image-box.is-loading-img');
    for (const box of missingBoxes) {
      const asin = box.dataset.asin;
      if (!asin || state.resolvingAsins.has(asin)) continue;

      state.resolvingAsins.add(asin);
      try {
        const res = await fetch(`/api/asin-image?asin=${encodeURIComponent(asin)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.image) {
            const img = box.querySelector('img');
            if (img) img.src = data.image;
            box.classList.remove('is-loading-img');
          }
        }
      } catch (e) {
        // silent fail
      }
    }
  }

  // Global image error handler
  window.handleImageError = function (imgEl, asin) {
    if (imgEl.dataset.failedOnce) return;
    imgEl.dataset.failedOnce = 'true';
    imgEl.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="%2394A3B8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  };

  /**
   * Refresh Images via /api/refresh-images
   */
  async function refreshImages() {
    if (state.isRefreshingImages) return;
    state.isRefreshingImages = true;

    if (elements.refreshImagesIcon) elements.refreshImagesIcon.classList.add('is-spinning');
    showToast('Refreshing product images from Amazon...', 'info');

    try {
      const res = await fetch('/api/refresh-images', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();
      showToast(`✓ Refreshed ${data.fetched || 0} images!`, 'success');
      await fetchLiveData(false);
    } catch (err) {
      showToast(`Image refresh failed: ${err.message}`, 'error');
    } finally {
      state.isRefreshingImages = false;
      if (elements.refreshImagesIcon) elements.refreshImagesIcon.classList.remove('is-spinning');
    }
  }

  /**
   * Auto-refresh countdown management
   */
  function startCountdown() {
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    state.countdown = 30;
    if (elements.countdownSeconds) elements.countdownSeconds.textContent = `${state.countdown}s`;

    state.countdownInterval = setInterval(() => {
      state.countdown--;
      if (elements.countdownSeconds) elements.countdownSeconds.textContent = `${state.countdown}s`;

      if (state.countdown <= 0) {
        clearInterval(state.countdownInterval);
        fetchLiveData(false);
      }
    }, 1000);
  }

  function resetCountdown() {
    startCountdown();
  }

  /**
   * Event Listeners Setup
   */
  function setupEventListeners() {
    // Top Live Refresh Button
    if (elements.btnSyncNow) {
      elements.btnSyncNow.addEventListener('click', () => fetchLiveData(true));
    }

    // Brand Bar Quick Refresh Button
    if (elements.btnQuickRefresh) {
      elements.btnQuickRefresh.addEventListener('click', () => fetchLiveData(true));
    }

    // Countdown Badge click triggers immediate refresh
    if (elements.countdownBadge) {
      elements.countdownBadge.addEventListener('click', () => fetchLiveData(true));
    }

    // Refresh Images Button
    if (elements.btnRefreshImages) {
      elements.btnRefreshImages.addEventListener('click', refreshImages);
    }

    // Search Input
    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        if (elements.searchClearBtn) {
          elements.searchClearBtn.style.display = state.searchQuery ? 'block' : 'none';
        }
        applyFiltersAndRender();
      });

      // Keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== elements.searchInput) {
          e.preventDefault();
          elements.searchInput.focus();
        } else if (e.key === 'Escape' && document.activeElement === elements.searchInput) {
          elements.searchInput.value = '';
          state.searchQuery = '';
          if (elements.searchClearBtn) elements.searchClearBtn.style.display = 'none';
          applyFiltersAndRender();
          elements.searchInput.blur();
        } else if ((e.key === 'r' || e.key === 'R') && document.activeElement !== elements.searchInput) {
          e.preventDefault();
          fetchLiveData(true);
        }
      });
    }

    // Clear Search Button
    if (elements.searchClearBtn) {
      elements.searchClearBtn.addEventListener('click', () => {
        elements.searchInput.value = '';
        state.searchQuery = '';
        elements.searchClearBtn.style.display = 'none';
        applyFiltersAndRender();
        elements.searchInput.focus();
      });
    }

    // Brand "All" Button
    if (elements.btnBrandAll) {
      elements.btnBrandAll.addEventListener('click', () => setBrandFilter('all'));
    }

    // Filter Tabs (All, Available, Low, Over)
    elements.filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        elements.filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.currentFilter = tab.dataset.filter;
        applyFiltersAndRender();
      });
    });

    // Show Slots Over Toggle
    if (elements.showSlotsOverCheckbox) {
      elements.showSlotsOverCheckbox.addEventListener('change', (e) => {
        state.showSlotsOver = e.target.checked;
        applyFiltersAndRender();
      });
    }

    // Reset Filters Button
    if (elements.btnResetFilters) {
      elements.btnResetFilters.addEventListener('click', () => {
        state.currentBrand = 'all';
        state.currentFilter = 'all';
        state.searchQuery = '';
        state.showSlotsOver = true;
        if (elements.showSlotsOverCheckbox) elements.showSlotsOverCheckbox.checked = true;
        if (elements.searchInput) elements.searchInput.value = '';
        if (elements.searchClearBtn) elements.searchClearBtn.style.display = 'none';
        if (elements.btnBrandAll) elements.btnBrandAll.classList.add('active');
        elements.filterTabs.forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
        applyFiltersAndRender();
      });
    }
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    fetchLiveData(false);
  });

})();
