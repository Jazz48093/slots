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
    showSlotsOver: false, // Hidden slots (≤ 0) are hidden by default; user turns on via toggle
    countdown: 30,
    countdownInterval: null,
    isSyncing: false,
    isRefreshingImages: false,
    resolvingAsins: new Set(),
    lastSyncTimestamp: null,
  };

  // DOM Elements
  const elements = {
    productGrid: document.getElementById('productGrid'),
    purgeLoadingView: document.getElementById('purgeLoadingView'),
    emptyState: document.getElementById('emptyState'),
    btnResetFilters: document.getElementById('btnResetFilters'),
    showSlotsOverCheckbox: document.getElementById('showSlotsOverCheckbox') || document.getElementById('hideSlotsOverCheckbox'),
    hideSlotsTooltip: document.getElementById('hideSlotsTooltip'),
    
    // Header & Controls
    searchInput: document.getElementById('searchInput'),
    searchClearBtn: document.getElementById('searchClearBtn'),
    btnSyncNow: document.getElementById('btnSyncNow'),
    syncIcon: document.getElementById('syncIcon'),
    btnRefreshImages: document.getElementById('btnRefreshImages'),
    refreshImagesIcon: document.getElementById('refreshImagesIcon'),
    countdownSeconds: document.getElementById('countdownSeconds'),
    lastSyncTime: document.getElementById('lastSyncTime'),
    
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
    const isMed = window.DATA_COL === 'i' || window.location.pathname.includes('/med') || window.location.search.includes('col=i') || window.location.search.includes('col=med');
    const colQuery = isMed ? '&col=i' : '&col=g';
    let loadedItems = [];

    try {
      // 1. Try Zero-Cache Proxy Endpoint
      const response = await fetch(`/api/data?_nocache=${timestamp}${colQuery}`, {
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
      const isMed = window.DATA_COL === 'i' || window.location.pathname.includes('/med') || window.location.search.includes('col=i') || window.location.search.includes('col=med');
      const lessColIdx = isMed ? 8 : 6;
      const lessRaw = (row[lessColIdx] || '').trim();
      
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
    const showOver = state.showSlotsOver;

    state.filteredItems = state.items.filter(item => {
      const status = getSlotStatus(item.remaining);

      // Hidden slots are hidden by default (remaining <= 0); user can turn on via toggle or on 'over' tab
      if (!showOver && status.category === 'over' && filter !== 'over') {
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
      elements.emptyState.style.display = 'flex';
      return;
    }

    elements.emptyState.style.display = 'none';
    elements.productGrid.style.display = 'grid';
    renderGrid();
  }

  /**
   * Render 6-column Product Showcase Grid
   */
  function renderGrid() {
    const html = state.filteredItems.map(item => {
      const status = getSlotStatus(item.remaining);
      const cardDisabledClass = status.isDisabled ? 'is-disabled' : '';

      // Clean image with fallback
      const hasImage = Boolean(item.image);
      const imageUrl = hasImage
        ? item.image
        : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="%2394A3B8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

      return `
        <div class="product-card glass-panel ${cardDisabledClass}">
          <!-- Image Chamber (No ASIN) -->
          <div class="product-image-box ${!hasImage ? 'is-loading-img' : ''}" data-asin="${escapeHtml(item.asin)}">
            <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" class="product-img" loading="lazy" data-asin="${escapeHtml(item.asin)}" onerror="window.handleImageError && window.handleImageError(this, '${escapeHtml(item.asin)}')">
          </div>

          <!-- Body -->
          <div class="card-body">
            <h3 class="product-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h3>

            <!-- Slot Status Badge -->
            <div class="slot-badge ${status.badgeClass}">
              <span>${status.label}</span>
            </div>

            <!-- Combined Bottom Row: Less % Tag + View Link & Copy Icon -->
            <div class="card-bottom-row">
              <div class="card-less-tag" title="Discount / Less percentage">
                <span class="card-less-label">Less</span>
                <span class="card-less-val">${escapeHtml(item.less || '-')}</span>
              </div>

              ${item.link && !status.isDisabled ? `
                <div class="card-action-btns">
                  <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="btn-product-link-small" title="Open product listing on Amazon">
                    <span>View Link</span>
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
    }).join('');

    elements.productGrid.innerHTML = html;
    resolveMissingImages();
  }

  /**
   * Asynchronously resolves missing images from /api/asin-image
   */
  async function resolveMissingImages() {
    const missingItems = state.filteredItems.filter(item => item.asin && !item.image && !state.resolvingAsins.has(item.asin));
    if (missingItems.length === 0) return;

    for (const item of missingItems) {
      state.resolvingAsins.add(item.asin);
      fetch(`/api/asin-image?asin=${encodeURIComponent(item.asin)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.image) {
            item.image = data.image;
            const mainItem = state.items.find(i => i.asin === item.asin);
            if (mainItem) mainItem.image = data.image;

            const boxes = document.querySelectorAll(`.product-image-box[data-asin="${item.asin}"]`);
            boxes.forEach(box => {
              box.classList.remove('is-loading-img');
              const img = box.querySelector('img');
              if (img) {
                img.style.opacity = '0';
                img.src = data.image;
                img.onload = () => { img.style.opacity = '1'; };
              }
            });
          } else {
            const boxes = document.querySelectorAll(`.product-image-box[data-asin="${item.asin}"]`);
            boxes.forEach(box => box.classList.remove('is-loading-img'));
          }
        })
        .catch(() => {
          const boxes = document.querySelectorAll(`.product-image-box[data-asin="${item.asin}"]`);
          boxes.forEach(box => box.classList.remove('is-loading-img'));
        });
    }
  }

  /**
   * Refreshes all product images from Amazon via /api/refresh-images
   */
  async function refreshAmazonImages() {
    if (state.isRefreshingImages) return;
    state.isRefreshingImages = true;

    if (elements.btnRefreshImages) {
      elements.btnRefreshImages.disabled = true;
    }
    if (elements.refreshImagesIcon) {
      elements.refreshImagesIcon.classList.add('spin-anim');
    }

    showToast('Refreshing images from Amazon...', '🔄');

    try {
      const response = await fetch('/api/refresh-images?force=1', {
        method: 'POST',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (response.ok) {
        const data = await response.json();
        const refreshedCount = data.refreshed || 0;
        showToast(`Amazon images refreshed! (${refreshedCount} updated)`, '✓');
      } else {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (err) {
      console.warn('Refresh images error:', err);
      showToast('Image refresh triggered in background', '🔄');
    } finally {
      state.isRefreshingImages = false;
      if (elements.btnRefreshImages) {
        elements.btnRefreshImages.disabled = false;
      }
      if (elements.refreshImagesIcon) {
        elements.refreshImagesIcon.classList.remove('spin-anim');
      }
      // Re-fetch live data to update the UI
      await fetchLiveData(false);
    }
  }

  /**
   * Fallback & recovery handler for broken or failed images
   */
  window.handleImageError = function(imgEl, asin) {
    if (!imgEl) return;
    const fallbackSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="%23cbd5e1" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

    if (!imgEl.dataset.retried && asin) {
      imgEl.dataset.retried = '1';
      fetch(`/api/asin-image?asin=${encodeURIComponent(asin)}&refresh=1`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.image) {
            imgEl.src = data.image;
          } else {
            imgEl.onerror = null;
            imgEl.src = fallbackSvg;
          }
        })
        .catch(() => {
          imgEl.onerror = null;
          imgEl.src = fallbackSvg;
        });
      return;
    }

    imgEl.onerror = null;
    imgEl.src = fallbackSvg;
  };

  /**
   * 30-second countdown cycle
   */
  function resetCountdown() {
    clearInterval(state.countdownInterval);
    state.countdown = 30;
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

    // Refresh Amazon Images Button
    if (elements.btnRefreshImages) {
      elements.btnRefreshImages.addEventListener('click', () => {
        refreshAmazonImages();
      });
    }

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
      if (elements.showSlotsOverCheckbox) {
        elements.showSlotsOverCheckbox.checked = false;
        state.showSlotsOver = false;
      }
      setActiveFilter('all');
    });

    // Show / Hide Slots Over Toggle Switch
    if (elements.showSlotsOverCheckbox) {
      elements.showSlotsOverCheckbox.addEventListener('change', (e) => {
        state.showSlotsOver = e.target.checked;
        applyFiltersAndRender();
        showToast(state.showSlotsOver ? 'Showing "slots over" products (≤ 0)' : 'Hiding "slots over" products');
      });
    }

    // Filter Tabs
    elements.filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const filter = tab.dataset.filter;
        setActiveFilter(filter);
      });
    });

    // 1-Click Copy Link to Clipboard
    elements.productGrid.addEventListener('click', async (e) => {
      const copyBtn = e.target.closest('.btn-copy-link-small');
      if (!copyBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const link = copyBtn.dataset.link;
      if (!link) return;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(link);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = link;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }

        copyBtn.classList.add('copied');
        showToast('Link copied to clipboard ✓', '📋');

        setTimeout(() => {
          copyBtn.classList.remove('copied');
        }, 1500);
      } catch (err) {
        console.error('Copy link error:', err);
        showToast('Unable to copy link', '⚠️');
      }
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
      } else if ((e.key === 'i' || e.key === 'I') && document.activeElement !== elements.searchInput) {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          refreshAmazonImages();
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

  /**
   * Automatically opens the "Hide slots over" tooltip after 3 seconds of loading
   */
  function setupTooltipOnboarding() {
    setTimeout(() => {
      const tooltip = elements.hideSlotsTooltip || document.getElementById('hideSlotsTooltip');
      const toggleSwitch = document.querySelector('.toggle-hide-switch');
      if (!tooltip) return;

      tooltip.classList.add('auto-show');

      // Dismiss gently if the user interacts or after 7 seconds
      const dismiss = () => {
        tooltip.classList.remove('auto-show');
        if (toggleSwitch) {
          toggleSwitch.removeEventListener('click', dismiss);
          toggleSwitch.removeEventListener('mouseenter', dismiss);
        }
      };

      if (toggleSwitch) {
        toggleSwitch.addEventListener('click', dismiss);
        toggleSwitch.addEventListener('mouseenter', dismiss);
      }

      setTimeout(dismiss, 7000);
    }, 3000);
  }

  // Initialization
  setupEventListeners();
  setupTooltipOnboarding();
  fetchLiveData(true);

})();
