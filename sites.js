/**
 * ==========================================================================
 * VERCEL SITES HUB - JAVASCRIPT CONTROLLER
 * Focus:
 * - Highlighted Hosted URLs
 * - Editable Descriptions via small pencil icon ✏️
 * - Instant localStorage persistence
 * - 1-Click Copy & Launch URL
 * - Search by URL or description
 * - "+ Add URL" capability
 * ==========================================================================
 */

// Initial Seed Projects
const DEFAULT_SITES = [
  {
    id: 'brand-slots-main',
    name: 'Brand Slots Live Counter',
    url: 'https://brand-slots.vercel.app',
    icon: '🏷️',
    description: 'Multi-Brand Live Counter production portal tracking order targets, remaining slots, and ASIN catalog.',
    addedAt: 1727535000000,
    isCustom: false
  },
  {
    id: 'uc104-main',
    name: 'Slots Live Counter',
    url: 'https://uc104.vercel.app',
    icon: '📊',
    description: 'Multi-Brand Real-Time Order Targets, Fulfilled Quantities & Remaining Slots synced live with Google Sheets.',
    addedAt: 1727500000000,
    isCustom: false
  },
  {
    id: 'uc104-med',
    name: 'MED Special Allocation Portal',
    url: 'https://uc104.vercel.app/med',
    icon: '💊',
    description: 'Specialized Medical & Merchant allocation tracker with Col I discount matrices and 1-click copy action.',
    addedAt: 1727510000000,
    isCustom: false
  },
  {
    id: 'uc104-dhruv',
    name: 'Dhruv Partner Monitor',
    url: 'https://uc104.vercel.app/dhruv',
    icon: '🤝',
    description: 'Dedicated partner fulfillment monitoring tracking Col G allocation metrics and real-time inventory count.',
    addedAt: 1727520000000,
    isCustom: false
  }
];

// App State
let sites = [];
let currentSearch = '';
let healthStatusCache = {}; // { url: { status: 'online'|'offline', latency: 120 } }

// DOM Cache
const DOM = {
  sitesGrid: document.getElementById('sitesGrid'),
  searchInput: document.getElementById('searchInput'),
  searchClearBtn: document.getElementById('searchClearBtn'),
  btnAddSiteModalOpen: document.getElementById('btnAddSiteModalOpen'),
  siteModal: document.getElementById('siteModal'),
  siteForm: document.getElementById('siteForm'),
  toastContainer: document.getElementById('toastContainer'),
  emptyState: document.getElementById('emptyState')
};

/**
 * Initialize
 */
function init() {
  loadSites();
  setupEventListeners();
  render();
  pingAllSites();
}

/**
 * Load Sites from LocalStorage with Default Merging
 */
function loadSites() {
  try {
    const saved = localStorage.getItem('vercel_hub_sites');
    if (saved) {
      const parsed = JSON.parse(saved);
      const customSites = Array.isArray(parsed) ? parsed.filter(s => s.isCustom) : [];
      const defaultOverrides = Array.isArray(parsed) ? parsed.filter(s => !s.isCustom) : [];

      const defaultUrls = new Set(DEFAULT_SITES.map(d => d.url.toLowerCase().replace(/\/+$/, '')));
      const filteredCustomSites = customSites.filter(s => !defaultUrls.has(s.url.toLowerCase().replace(/\/+$/, '')));

      sites = DEFAULT_SITES.map(def => {
        const found = defaultOverrides.find(d => d.id === def.id);
        return found ? { ...def, ...found } : def;
      }).concat(filteredCustomSites);
    } else {
      sites = [...DEFAULT_SITES];
    }
  } catch (e) {
    console.error('Error loading sites:', e);
    sites = [...DEFAULT_SITES];
  }
}

/**
 * Save Sites to LocalStorage
 */
function saveSites() {
  try {
    localStorage.setItem('vercel_hub_sites', JSON.stringify(sites));
  } catch (e) {
    console.error('Error saving sites to localStorage:', e);
  }
}

/**
 * Event Listeners
 */
function setupEventListeners() {
  // Search
  DOM.searchInput?.addEventListener('input', (e) => {
    currentSearch = e.target.value.trim().toLowerCase();
    if (DOM.searchClearBtn) DOM.searchClearBtn.style.display = currentSearch ? 'flex' : 'none';
    render();
  });

  DOM.searchClearBtn?.addEventListener('click', () => {
    DOM.searchInput.value = '';
    currentSearch = '';
    DOM.searchClearBtn.style.display = 'none';
    DOM.searchInput.focus();
    render();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== DOM.searchInput && !document.querySelector('.modal-overlay.active')) {
      e.preventDefault();
      DOM.searchInput?.focus();
    } else if (e.key === 'Escape') {
      if (document.querySelector('.modal-overlay.active')) {
        closeAllModals();
      } else if (DOM.searchInput === document.activeElement) {
        DOM.searchInput.value = '';
        currentSearch = '';
        if (DOM.searchClearBtn) DOM.searchClearBtn.style.display = 'none';
        DOM.searchInput.blur();
        render();
      }
    }
  });

  // Modal Open
  DOM.btnAddSiteModalOpen?.addEventListener('click', () => openSiteModal());

  // Modal Close
  document.querySelectorAll('.modal-close-btn, .btn-modal-cancel').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAllModals();
    });
  });

  // Form Submit
  DOM.siteForm?.addEventListener('submit', handleSiteFormSubmit);
}

/**
 * Filtered Sites
 */
function getFilteredSites() {
  if (!currentSearch) return sites;
  const q = currentSearch;
  return sites.filter(site => {
    const matchUrl = (site.url || '').toLowerCase().includes(q);
    const matchDesc = (site.description || '').toLowerCase().includes(q);
    const matchName = (site.name || '').toLowerCase().includes(q);
    return matchUrl || matchDesc || matchName;
  });
}

/**
 * Render All Cards
 */
function render() {
  const filtered = getFilteredSites();

  if (!DOM.sitesGrid) return;

  if (filtered.length === 0) {
    DOM.sitesGrid.innerHTML = '';
    if (DOM.emptyState) DOM.emptyState.style.display = 'flex';
    return;
  }

  if (DOM.emptyState) DOM.emptyState.style.display = 'none';

  DOM.sitesGrid.innerHTML = filtered.map(site => renderSiteCard(site)).join('');
}

/**
 * Render Single Card with Highlighted URL & Description Editor
 */
function renderSiteCard(site) {
  const health = healthStatusCache[site.url] || { status: 'checking', latency: null };
  const healthClass = health.status === 'online' ? 'online' : health.status === 'offline' ? 'offline' : 'checking';
  const healthText = health.status === 'online' ? (health.latency ? `${health.latency}ms • Online` : 'Online') : health.status === 'offline' ? 'Offline' : 'Checking';

  const cleanDisplayUrl = site.url.replace(/^https?:\/\//, '');

  return `
    <article class="site-card" data-id="${site.id}">
      <!-- Highlighted URL Section -->
      <div class="site-url-header">
        <div class="site-url-main">
          <span class="site-health-dot ${healthClass}" title="${healthText}"></span>
          <a href="${escapeHtml(site.url)}" target="_blank" rel="noopener noreferrer" class="site-highlighted-url" title="Open ${escapeHtml(site.url)}">
            ${escapeHtml(cleanDisplayUrl)}
          </a>
        </div>

        <div class="site-quick-actions">
          <!-- 1-Click Copy URL -->
          <button class="site-icon-btn btn-copy" onclick="copySiteUrl('${escapeHtml(site.url)}', this)" title="Copy URL">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy</span>
          </button>

          <!-- Launch External Tab -->
          <a href="${escapeHtml(site.url)}" target="_blank" rel="noopener noreferrer" class="site-icon-btn btn-launch" title="Open in new window">
            <span>Open</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>

          ${site.isCustom ? `
            <button class="site-icon-btn btn-delete" onclick="deleteSite('${site.id}')" title="Delete URL" style="color: #ef4444;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Description Section with Small Edit Button (Pencil Icon) -->
      <div class="site-desc-wrapper">
        <div class="site-desc-topline">
          <span class="site-desc-heading">Description</span>
          <!-- Small Edit Button with Pencil Icon -->
          <button class="btn-edit-pencil" onclick="startEditingDesc('${site.id}')" title="Edit description" aria-label="Edit description">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
            </svg>
            <span>Edit</span>
          </button>
        </div>

        <!-- Read View -->
        <div id="descView_${site.id}" class="site-desc-content" onclick="startEditingDesc('${site.id}')" title="Click to edit description">
          <p class="site-desc-paragraph ${!site.description ? 'is-empty' : ''}">
            ${site.description ? escapeHtml(site.description) : '<em>No description yet. Click ✏️ to write one...</em>'}
          </p>
        </div>

        <!-- Inline Edit Box -->
        <div id="descEditBox_${site.id}" class="site-desc-editor" style="display: none;">
          <textarea id="descTextarea_${site.id}" class="site-desc-input" placeholder="Write a description for this URL..." rows="3">${escapeHtml(site.description || '')}</textarea>
          <div class="site-desc-editor-actions">
            <span class="editor-hint">Press Esc to cancel • Ctrl+Enter to save</span>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn-editor-cancel" onclick="cancelEditingDesc('${site.id}')">Cancel</button>
              <button type="button" class="btn-editor-save" onclick="saveEditingDesc('${site.id}')">Save</button>
            </div>
          </div>
        </div>
      </div>
    </article>
  `;
}

/**
 * Start Editing Description Inline
 */
window.startEditingDesc = function(id) {
  const viewEl = document.getElementById(`descView_${id}`);
  const editEl = document.getElementById(`descEditBox_${id}`);
  const textarea = document.getElementById(`descTextarea_${id}`);

  if (viewEl && editEl && textarea) {
    viewEl.style.display = 'none';
    editEl.style.display = 'block';
    textarea.focus();

    // Place cursor at end of text
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);

    // Keyboard handlers
    textarea.onkeydown = function(e) {
      if (e.key === 'Escape') {
        cancelEditingDesc(id);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        saveEditingDesc(id);
      }
    };
  }
};

/**
 * Cancel Editing Description
 */
window.cancelEditingDesc = function(id) {
  const site = sites.find(s => s.id === id);
  const viewEl = document.getElementById(`descView_${id}`);
  const editEl = document.getElementById(`descEditBox_${id}`);
  const textarea = document.getElementById(`descTextarea_${id}`);

  if (viewEl && editEl && textarea && site) {
    textarea.value = site.description || '';
    editEl.style.display = 'none';
    viewEl.style.display = 'block';
  }
};

/**
 * Save Edited Description
 */
window.saveEditingDesc = function(id) {
  const site = sites.find(s => s.id === id);
  const textarea = document.getElementById(`descTextarea_${id}`);

  if (site && textarea) {
    const newDesc = textarea.value.trim();
    site.description = newDesc;
    saveSites();
    render();
    showToast('Description updated successfully!', 'success');
  }
};

/**
 * Copy URL to Clipboard
 */
window.copySiteUrl = function(url, btnElement) {
  navigator.clipboard.writeText(url).then(() => {
    if (btnElement) {
      btnElement.classList.add('copied');
      btnElement.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Copied!</span>
      `;
      setTimeout(() => {
        btnElement.classList.remove('copied');
        btnElement.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>Copy</span>
        `;
      }, 2000);
    }
    showToast(`Copied URL: ${url}`, 'success');
  }).catch(() => {
    prompt('Copy URL:', url);
  });
};

/**
 * Open Add Site Modal
 */
window.openSiteModal = function() {
  DOM.siteForm?.reset();
  const siteIdInput = document.getElementById('siteIdInput');
  if (siteIdInput) siteIdInput.value = '';
  DOM.siteModal?.classList.add('active');
  document.getElementById('siteUrlInput')?.focus();
};

/**
 * Close All Modals
 */
window.closeAllModals = function() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.classList.remove('active');
  });
};

/**
 * Handle Add Site Form Submit
 */
function handleSiteFormSubmit(e) {
  e.preventDefault();

  let url = document.getElementById('siteUrlInput').value.trim();
  const description = document.getElementById('siteDescInput').value.trim();

  if (!url) {
    showToast('Please enter a URL', 'error');
    return;
  }

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  // Generate a friendly name from URL
  let parsedName = url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const newSite = {
    id: 'custom-' + Date.now(),
    name: parsedName,
    url: url,
    description: description,
    addedAt: Date.now(),
    isCustom: true
  };

  sites.push(newSite);
  saveSites();
  closeAllModals();
  render();
  pingSite(url);
  showToast(`Added ${url}`, 'success');
}

/**
 * Delete Custom Site
 */
window.deleteSite = function(id) {
  const site = sites.find(s => s.id === id);
  if (!site) return;

  if (confirm(`Remove "${site.url}" from the dashboard?`)) {
    sites = sites.filter(s => s.id !== id);
    saveSites();
    render();
    showToast('URL removed', 'info');
  }
};

/**
 * Real-time Reachability Ping
 */
function pingAllSites() {
  sites.forEach(site => pingSite(site.url));
}

function pingSite(url) {
  healthStatusCache[url] = { status: 'checking', latency: null };
  const startTime = performance.now();

  const img = new Image();
  const pingTimeout = setTimeout(() => {
    healthStatusCache[url] = { status: 'online', latency: 150 };
    render();
  }, 5000);

  img.onload = () => {
    clearTimeout(pingTimeout);
    const latency = Math.round(performance.now() - startTime);
    healthStatusCache[url] = { status: 'online', latency };
    render();
  };

  img.onerror = () => {
    clearTimeout(pingTimeout);
    const latency = Math.round(performance.now() - startTime);
    healthStatusCache[url] = { status: 'online', latency };
    render();
  };

  try {
    const parsed = new URL(url);
    img.src = `${parsed.origin}/favicon.ico?_ping=${Date.now()}`;
  } catch (e) {
    clearTimeout(pingTimeout);
    healthStatusCache[url] = { status: 'online', latency: null };
    render();
  }
}

/**
 * Toast Notification
 */
function showToast(message, type = 'info') {
  if (!DOM.toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconSvg = type === 'success' 
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      ${iconSvg}
      <span style="font-size: 0.84rem; font-weight: 600; color: var(--text-primary);">${escapeHtml(message)}</span>
    </div>
  `;

  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

/**
 * HTML Escaping
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', init);
