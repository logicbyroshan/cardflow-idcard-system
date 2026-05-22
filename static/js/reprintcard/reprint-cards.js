/**
 * Reprint Cards - 3-step workflow JS.
 * Reprint List (approved/download source) -> Request List -> Confirmed List
 */
(function() {
'use strict';

var TABLE_ID = window.TABLE_ID;
var ENDPOINTS = window.REPRINT_ENDPOINTS || {};
if (!TABLE_ID || !ENDPOINTS.stepCounts) return;

var IS_CLIENT_USER = !!window.IS_CLIENT_USER;
var IS_CLIENT_STAFF_USER = !!window.IS_CLIENT_STAFF_USER;
var IS_ADMIN_CONTEXT = !(IS_CLIENT_USER || IS_CLIENT_STAFF_USER);

var showToast = window.showToast || function() {};
var escapeHtml = window.escapeHtml || function(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
};

function normalizeFieldKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getFieldSchemaFromHeader(tableBody) {
  if (!tableBody) return [];
  var table = tableBody.closest('table');
  if (!table) return [];
  return Array.from(table.querySelectorAll('thead th[data-field-name]')).map(function(th) {
    return {
      name: String(th.getAttribute('data-field-name') || '').trim(),
      type: String(th.getAttribute('data-field-type') || 'text').trim()
    };
  }).filter(function(f) { return !!f.name; });
}

function alignOrderedFieldsToSchema(fields, schema) {
  var source = Array.isArray(fields) ? fields : [];
  if (!Array.isArray(schema) || !schema.length) return source;

  var byKey = {};
  source.forEach(function(f) {
    var k = normalizeFieldKey(f && f.name);
    if (!k) return;
    byKey[k] = f;
  });

  return schema.map(function(s) {
    var k = normalizeFieldKey(s && s.name);
    var match = byKey[k];
    if (match) return match;
    return { name: s.name, type: s.type || 'text', value: '' };
  });
}

function normalizeMediaPath(rawPath) {
  var value = String(rawPath || '').trim();
  if (!value) return '';
  if (value === 'NOT_FOUND' || value.indexOf('PENDING:') === 0) return value;

  if (/^https?:\/\//i.test(value)) {
    try {
      var parsed = new URL(value);
      value = parsed.pathname || value;
    } catch (_e) {}
  }

  value = value.replace(/\\/g, '/');
  value = value.replace(/\/{2,}/g, '/');

  // If path contains /media/ or /mediafiles/ anywhere (including absolute FS paths),
  // keep only marker-relative part.
  var lower = value.toLowerCase();
  var mediaMarker = '/media/';
  var mediafilesMarker = '/mediafiles/';
  var markerIndexMediafiles = lower.indexOf(mediafilesMarker);
  if (markerIndexMediafiles !== -1) {
    value = value.slice(markerIndexMediafiles + mediafilesMarker.length);
    value = 'mediafiles/' + value;
  } else {
    var markerIndexMedia = lower.indexOf(mediaMarker);
    if (markerIndexMedia !== -1) {
      value = value.slice(markerIndexMedia + mediaMarker.length);
      value = 'media/' + value;
    }
  }

  value = value.replace(/^\/+/, '');
  value = value.replace(/\/{2,}/g, '/');
  return value;
}

function toMediaUrl(rawPath) {
  var original = String(rawPath || '').trim();
  if (!original || original === 'NOT_FOUND' || original.indexOf('PENDING:') === 0) return '';
  if (/^https?:\/\//i.test(original)) return original;

  var normalized = normalizeMediaPath(original);
  if (!normalized || normalized === 'NOT_FOUND' || normalized.indexOf('PENDING:') === 0) return '';

  normalized = normalized.replace(/^\/+/, '');
  var lower = normalized.toLowerCase();
  if (lower.indexOf('media/') === 0) {
    normalized = normalized.slice('media/'.length);
  }

  return '/media/' + normalized;
}

function toThumbnailPath(rawPath) {
  var normalized = normalizeMediaPath(rawPath);
  if (!normalized || normalized === 'NOT_FOUND' || normalized.indexOf('PENDING:') === 0) return '';

  normalized = normalized.replace(/^\/+/, '');
  var lower = normalized.toLowerCase();
  if (lower.indexOf('media/') === 0) {
    normalized = normalized.slice('media/'.length);
    lower = normalized.toLowerCase();
  }

  if (lower.indexOf('thumbs/') === 0 || lower.indexOf('/thumbs/') !== -1) {
    return normalized;
  }

  var parts = normalized.split('/');
  if (parts.length < 2) return normalized;

  var baseFolder = parts.shift();
  var rest = parts.join('/');
  var dot = rest.lastIndexOf('.');
  if (dot > 0) {
    rest = rest.slice(0, dot) + '.webp';
  }
  return baseFolder + '/thumbs/' + rest;
}

function isImageField(type, name) {
  if (!type && !name) return false;
  var t = (type || '').toLowerCase();
  var n = (name || '').toLowerCase();
  return t === 'image' || t === 'photo' || t === 'file' ||
         t.indexOf('image') !== -1 || t.indexOf('photo') !== -1 || t.indexOf('file') !== -1 ||
         n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img' ||
         n.indexOf('photo') !== -1 || n.indexOf('image') !== -1 || n.indexOf('signature') !== -1;
}

function renderImageCell(f) {
  var html = '<td class="w-[28px] px-[1px] py-1 text-center align-middle image-field image-cell" data-field="' + escapeHtml(f.name) + '" data-field-name="' + escapeHtml(f.name) + '" data-field-type="image" data-original-value="' + escapeHtml(f.value || '') + '">';
  html += '<div class="image-with-edit">';
  var mainUrl = toMediaUrl(f.value || '');
  var thumbUrl = toMediaUrl(toThumbnailPath(f.value || ''));
  if (mainUrl) {
    var firstUrl = thumbUrl || mainUrl;
    html += '<img src="' + escapeHtml(firstUrl) + '" alt="' + escapeHtml(f.name) + '" class="table-image" loading="lazy" onerror="this.onerror=null; this.src=\'' + escapeHtml(mainUrl) + '\'">';
  } else if (f.value && f.value.startsWith('PENDING:')) {
    html += '<div class="no-image pending-placeholder" title="Waiting for upload"><i class="fa-solid fa-clock"></i></div>';
  } else {
    html += '<div class="no-image colorful-placeholder" title="No image"><i class="fa-solid fa-user-astronaut"></i></div>';
  }
  html += '</div></td>';
  return html;
}

function renderTextCell(f) {
  var widthClass = (window.FieldClassifier) ? window.FieldClassifier.tdClass(f.name, f.type) : '';
  return '<td class="dynamic-field ' + widthClass + ' px-[1px] py-1 align-middle" data-field="' + escapeHtml(f.name) + '" data-field-name="' + escapeHtml(f.name) + '" data-field-type="' + escapeHtml(f.type || 'text') + '" data-original-value="' + escapeHtml(f.value || '') + '"><span class="cell-value">' + escapeHtml(f.value || '-') + '</span></td>';
}

function renderOrderedFields(fields, schema) {
  if (!fields) return '';
  var aligned = alignOrderedFieldsToSchema(fields, schema);
  var html = '';
  // Preserve API field order so table cells always align with header columns.
  aligned.forEach(function(f) {
    html += isImageField(f.type, f.name) ? renderImageCell(f) : renderTextCell(f);
  });
  return html;
}

function updateTabCount(sel, count) {
  var el = document.querySelector(sel);
  if (el) el.textContent = count;
}

function openCardDrawer(mode, cardId) {
  var fn = (typeof window.fetchCardAndOpenModal === 'function')
    ? window.fetchCardAndOpenModal
    : (window.IDCardApp && typeof window.IDCardApp.fetchCardAndOpenModal === 'function'
      ? window.IDCardApp.fetchCardAndOpenModal
      : null);

  if (!fn) {
    showToast('Edit/View drawer is unavailable right now.', 'warning');
    return false;
  }

  fn(mode, cardId);
  return true;
}

function initClassSectionFilters(cfg) {
  cfg = cfg || {};
  var prefix = cfg.prefix || '';
  var onChange = (typeof cfg.onChange === 'function') ? cfg.onChange : function() {};

  function byId(id) { return document.getElementById(prefix + id); }

  var classDropdown = byId('ClassFilterDropdown');
  var classToggle = byId('ClassFilterToggle');
  var classText = byId('ClassFilterText');
  var classOptions = byId('ClassFilterOptions');

  var sectionDropdown = byId('SectionFilterDropdown');
  var sectionToggle = byId('SectionFilterToggle');
  var sectionText = byId('SectionFilterText');
  var sectionOptions = byId('SectionFilterOptions');

  var clearBtn = byId('ClearFiltersBtn');

  if (!classOptions && !sectionOptions) {
    return {
      getClassFilter: function() { return ''; },
      getSectionFilter: function() { return ''; }
    };
  }

  var currentClass = '';
  var currentSection = '';
  var allClassOptions = [];
  var allSectionOptions = [];
  var classToSections = {};
  var sectionToClasses = {};

  function classOptionValue(opt) {
    if (opt && typeof opt === 'object') return String(opt.value || '').trim();
    return String(opt || '').trim();
  }

  function classOptionLabel(opt) {
    if (opt && typeof opt === 'object') return String(opt.display || opt.value || '').trim();
    return String(opt || '').trim();
  }

  function updateClearButton() {
    if (!clearBtn) return;
    if (currentClass || currentSection) clearBtn.classList.add('visible');
    else clearBtn.classList.remove('visible');
  }

  function markSelected(optionsEl, value) {
    if (!optionsEl) return;
    var opts = optionsEl.querySelectorAll('.dropdown-option');
    var found = null;
    opts.forEach(function(o) {
      var isMatch = (o.getAttribute('data-value') || '') === value;
      o.classList.toggle('selected', isMatch);
      if (isMatch) found = o;
    });
    if (!found && opts.length) opts[0].classList.add('selected');
  }

  function renderDependentOptions() {
    var allowedClassValues = allClassOptions.map(classOptionValue);
    var allowedSectionValues = allSectionOptions.slice();

    if (currentSection) {
      var bySection = sectionToClasses[currentSection] || [];
      if (bySection.length) allowedClassValues = bySection.slice();
    }
    if (currentClass) {
      var byClass = classToSections[currentClass] || [];
      if (byClass.length) allowedSectionValues = byClass.slice();
    }

    var classAllowed = new Set(allowedClassValues.map(function(v) { return String(v); }));
    var sectionAllowed = new Set(allowedSectionValues.map(function(v) { return String(v); }));

    var filteredClass = allClassOptions.filter(function(o) { return classAllowed.has(classOptionValue(o)); });
    var filteredSection = allSectionOptions.filter(function(v) { return sectionAllowed.has(String(v)); });

    if (classOptions) {
      classOptions.innerHTML = '<div class="dropdown-option" data-value="">All Classes</div>' +
        filteredClass.map(function(opt) {
          var value = classOptionValue(opt);
          var label = classOptionLabel(opt);
          return '<div class="dropdown-option" data-value="' + escapeHtml(value) + '">' + escapeHtml(label) + '</div>';
        }).join('');
    }

    if (sectionOptions) {
      sectionOptions.innerHTML = '<div class="dropdown-option" data-value="">All Sections</div>' +
        filteredSection.map(function(v) {
          var s = String(v);
          return '<div class="dropdown-option" data-value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</div>';
        }).join('');
    }

    var classValid = !currentClass || filteredClass.some(function(o) { return classOptionValue(o) === currentClass; });
    var sectionValid = !currentSection || filteredSection.some(function(v) { return String(v) === currentSection; });
    if (!classValid) currentClass = '';
    if (!sectionValid) currentSection = '';

    if (classText) {
      if (currentClass) {
        var lbl = filteredClass.find(function(o) { return classOptionValue(o) === currentClass; });
        classText.textContent = lbl ? classOptionLabel(lbl) : 'All Classes';
      } else {
        classText.textContent = 'All Classes';
      }
    }
    if (sectionText) {
      sectionText.textContent = currentSection || 'All Sections';
    }

    markSelected(classOptions, currentClass);
    markSelected(sectionOptions, currentSection);
    updateClearButton();
  }

  function bindDropdown(dropdown, toggle, optionsEl, onPick, closeOther) {
    if (!dropdown || !toggle || !optionsEl) return;
    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      if (closeOther) closeOther.classList.remove('open');
      dropdown.classList.toggle('open');
    });

    optionsEl.addEventListener('click', function(e) {
      var opt = e.target.closest('.dropdown-option');
      if (!opt) return;
      onPick(opt.getAttribute('data-value') || '');
      dropdown.classList.remove('open');
      renderDependentOptions();
      onChange(currentClass, currentSection);
    });

    document.addEventListener('click', function(e) {
      if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
    });
  }

  bindDropdown(classDropdown, classToggle, classOptions, function(value) {
    currentClass = value;
  }, sectionDropdown);

  bindDropdown(sectionDropdown, sectionToggle, sectionOptions, function(value) {
    currentSection = value;
  }, classDropdown);

  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      currentClass = '';
      currentSection = '';
      renderDependentOptions();
      onChange(currentClass, currentSection);
    });
  }

  ApiClient.get('/api/table/' + TABLE_ID + '/filter-options/')
    .then(function(data) {
      if (!data || !data.success) return;
      allClassOptions = Array.isArray(data.class_values) ? data.class_values.slice() : [];
      allSectionOptions = Array.isArray(data.section_values) ? data.section_values.slice() : [];
      classToSections = data.class_to_sections || {};
      sectionToClasses = data.section_to_classes || {};
      renderDependentOptions();
    })
    .catch(function() {});

  return {
    getClassFilter: function() { return currentClass; },
    getSectionFilter: function() { return currentSection; }
  };
}

function refreshStepCounts() {
  ApiClient.get(ENDPOINTS.stepCounts)
    .then(function(data) {
      if (data.status !== 'ok') return;
      updateTabCount('.reprint-confirm-tab .tab-count', data.request_list || 0);
      updateTabCount('.reprint-pool-tab .tab-count', data.confirmed || 0);
      var requestCount = document.getElementById('downloadRequestCount');
      var confirmedCount = document.getElementById('downloadConfirmedCount');
      var requestDownloadCount = document.getElementById('requestDownloadCount');
      var confirmedDownloadCount = document.getElementById('confirmedDownloadCount');
      if (requestCount) requestCount.textContent = data.request_list || 0;
      if (confirmedCount) confirmedCount.textContent = data.confirmed || 0;
      if (requestDownloadCount) requestDownloadCount.textContent = data.download_list || 0;
      if (confirmedDownloadCount) confirmedDownloadCount.textContent = data.download_list || 0;
    })
    .catch(function() {});
}

function createPaginator(opts) {
  var currentPage = 1;
  var rowsPerPage = 50;

  var bar = document.getElementById(opts.barId);
  if (!bar) return null;

  var showingRange = document.getElementById(opts.prefix + 'ShowingRange');
  var totalCountEl = document.getElementById(opts.prefix + 'TotalCount');
  var firstBtn = document.getElementById(opts.prefix + 'FirstPage');
  var prevBtn = document.getElementById(opts.prefix + 'PrevPage');
  var nextBtn = document.getElementById(opts.prefix + 'NextPage');
  var lastBtn = document.getElementById(opts.prefix + 'LastPage');
  var pageNumsEl = document.getElementById(opts.prefix + 'PageNumbers');
  var selInfoEl = document.getElementById(opts.prefix + 'SelectionInfo');
  var selCountEl = document.getElementById(opts.prefix + 'SelectedCount');
  var rowsDropdown = document.getElementById(opts.prefix + 'RowsDropdown');
  var rowsToggle = document.getElementById(opts.prefix + 'RowsToggle');
  var rowsOptions = document.getElementById(opts.prefix + 'RowsOptions');
  var rowsSelText = document.getElementById(opts.prefix + 'RowsSelectedText');

  function getAllRows() {
    var tb = opts.getTableBody();
    return tb ? Array.from(tb.querySelectorAll('tr:not(.no-data-row)')) : [];
  }

  function paginate() {
    var rows = getAllRows();
    var total = rows.length;
    if (total === 0) {
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = '0';
      if (bar) bar.style.display = 'none';
      return;
    }
    if (bar) bar.style.display = '';

    var rpp = (rowsPerPage === 'all') ? total : rowsPerPage;
    var totalPages = Math.ceil(total / rpp);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = (currentPage - 1) * rpp;
    var endIdx = Math.min(startIdx + rpp, total);

    rows.forEach(function(row, idx) {
      row.style.display = (idx >= startIdx && idx < endIdx) ? '' : 'none';
    });

    if (showingRange) showingRange.textContent = (startIdx + 1) + '-' + endIdx;
    if (totalCountEl) totalCountEl.textContent = total;

    renderPageNumbers(totalPages);
    if (firstBtn) firstBtn.disabled = currentPage <= 1;
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    if (lastBtn) lastBtn.disabled = currentPage >= totalPages;
  }

  function renderPageNumbers(totalPages) {
    if (!pageNumsEl) return;
    var html = '';
    var start = Math.max(1, currentPage - 2);
    var end = Math.min(totalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (var i = start; i <= end; i++) {
      html += '<button class="page-num' + (i === currentPage ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>';
    }
    pageNumsEl.innerHTML = html;
  }

  function goToPage(page) {
    var rows = getAllRows();
    var total = rows.length;
    var rpp = (rowsPerPage === 'all') ? total : rowsPerPage;
    var maxPage = Math.max(1, Math.ceil(total / rpp));
    currentPage = Math.max(1, Math.min(page, maxPage));
    paginate();
  }

  function reset() { currentPage = 1; }

  function updateSelectionCount(count) {
    if (!selInfoEl || !selCountEl) return;
    if (count > 0) {
      selCountEl.textContent = count;
      selInfoEl.style.display = '';
    } else {
      selInfoEl.style.display = 'none';
    }
  }

  if (firstBtn) firstBtn.addEventListener('click', function() { goToPage(1); });
  if (prevBtn) prevBtn.addEventListener('click', function() { goToPage(currentPage - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function() { goToPage(currentPage + 1); });
  if (lastBtn) {
    lastBtn.addEventListener('click', function() {
      var rows = getAllRows();
      var total = rows.length;
      var rpp = (rowsPerPage === 'all') ? total : rowsPerPage;
      goToPage(Math.max(1, Math.ceil(total / rpp)));
    });
  }

  if (pageNumsEl) {
    pageNumsEl.addEventListener('click', function(e) {
      var btn = e.target.closest('.page-num');
      if (btn) goToPage(parseInt(btn.dataset.page, 10));
    });
  }

  if (rowsToggle && rowsDropdown) {
    rowsToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      rowsDropdown.classList.toggle('open');
    });
  }

  if (rowsOptions) {
    rowsOptions.addEventListener('click', function(e) {
      var option = e.target.closest('.dropdown-option');
      if (!option) return;
      var val = option.dataset.value;
      rowsPerPage = (val === 'all') ? 'all' : parseInt(val, 10);
      currentPage = 1;
      rowsOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
      option.classList.add('selected');
      if (rowsSelText) rowsSelText.textContent = (val === 'all') ? 'All' : val;
      if (rowsDropdown) rowsDropdown.classList.remove('open');
      paginate();
    });
  }

  document.addEventListener('click', function(e) {
    if (rowsDropdown && !rowsDropdown.contains(e.target)) rowsDropdown.classList.remove('open');
  });

  return {
    paginate: paginate,
    reset: reset,
    updateSelectionCount: updateSelectionCount,
  };
}

function updateEmptyTable(tableBody, iconClass, text, totalCountEl, showingRange) {
  tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="' + iconClass + '"></i><span>' + text + '</span></div></td></tr>';
  if (showingRange) showingRange.textContent = '0';
  if (totalCountEl) totalCountEl.textContent = '0';
}

function getCsrfToken() {
  if (typeof window.getCSRFToken === 'function') {
    return window.getCSRFToken();
  }

  var meta = document.querySelector('meta[name="csrf-token"]');
  if (meta && meta.getAttribute('content')) return meta.getAttribute('content');

  var hidden = document.querySelector('input[name="csrfmiddlewaretoken"]');
  if (hidden && hidden.value) return hidden.value;

  var match = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function getSessionRefreshUrl() {
  if (typeof window.getSessionRefreshUrl === 'function') {
    return window.getSessionRefreshUrl();
  }

  if (window.location.pathname.indexOf('/panel/') === 0) {
    return '/panel/auth/api/auth/session-refresh/';
  }
  if (window.location.pathname.indexOf('/app/') === 0) {
    return '/app/auth/api/auth/session-refresh/';
  }
  return '/auth/api/auth/session-refresh/';
}

function applyCsrfToken(token) {
  if (!token) return;

  var meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) meta.setAttribute('content', token);

  var hiddenInputs = document.querySelectorAll('input[name="csrfmiddlewaretoken"]');
  for (var i = 0; i < hiddenInputs.length; i += 1) {
    hiddenInputs[i].value = token;
  }
}

async function refreshSessionToken() {
  try {
    var resp = await fetch(getSessionRefreshUrl(), {
      method: 'GET',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin'
    });

    if (!resp.ok) return '';

    var data = await resp.json().catch(function() { return {}; });
    if (data && data.csrf_token) {
      applyCsrfToken(data.csrf_token);
      return data.csrf_token;
    }
  } catch (_e) {}

  return '';
}

function isSessionExpiredError(status, message) {
  if (status === 401) return true;
  if (status !== 403) return false;
  return /session expired|security token expired/i.test(String(message || ''));
}

function parseFilenameFromDisposition(disposition, fallbackExt) {
  if (disposition) {
    var utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch && utfMatch[1]) return decodeURIComponent(utfMatch[1]);
    var plainMatch = disposition.match(/filename="?([^";]+)"?/i);
    if (plainMatch && plainMatch[1]) return plainMatch[1];
  }
  var parts = [window.CLIENT_NAME || '', window.TABLE_NAME || '', 'Reprint'].filter(Boolean).map(function(v) {
    return String(v).replace(/\s+/g, '');
  });
  return (parts.length ? parts.join('_') : 'export') + '.' + fallbackExt;
}

function triggerBlobDownload(blob, filename) {
  var url = window.URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    window.URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 0);
}

function triggerUrlDownload(url, filename) {
  if (!url) return;
  var a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 0);
}

function decodeBase64ToBlob(base64Str, mimeType) {
  var bytes = atob(base64Str || '');
  var len = bytes.length;
  var arr = new Uint8Array(len);
  for (var i = 0; i < len; i += 1) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType || 'application/octet-stream' });
}

async function postJsonForBlob(url, body, retried) {
  retried = !!retried;
  var resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCsrfToken(),
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify(body || {})
  });

  if (!resp.ok) {
    var errText = 'Download failed';
    try {
      var errJson = await resp.json();
      errText = errJson.message || errText;
    } catch (_e) {
      try {
        errText = await resp.text();
      } catch (_e2) {}
    }

    if (!retried && isSessionExpiredError(resp.status, errText)) {
      var freshToken = await refreshSessionToken();
      if (freshToken) {
        return postJsonForBlob(url, body, true);
      }
    }

    throw new Error(errText);
  }

  var contentType = (resp.headers.get('Content-Type') || '').toLowerCase();
  if (contentType.indexOf('application/json') !== -1) {
    var jsonData = await resp.json().catch(function() { return {}; });
    if (jsonData && jsonData.success && jsonData.async && jsonData.task_id) {
      for (var i = 0; i < 300; i += 1) {
        var statusResp = await fetch('/api/export/status/' + jsonData.task_id + '/', {
          headers: {
            'X-CSRFToken': getCsrfToken(),
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        var statusData = await statusResp.json().catch(function() { return {}; });

        if (statusData.state === 'completed' && statusData.download_url) {
          return {
            download_url: statusData.download_url,
            filename: statusData.filename || parseFilenameFromDisposition('', 'bin')
          };
        }

        if (statusData.state === 'failed') {
          throw new Error(statusData.message || 'Export failed');
        }

        await new Promise(function(resolve) { setTimeout(resolve, 2000); });
      }
      throw new Error('Export timed out');
    }

    throw new Error((jsonData && jsonData.message) || 'Unexpected download response');
  }

  var blob = await resp.blob();
  var filename = parseFilenameFromDisposition(resp.headers.get('Content-Disposition'), 'bin');
  return { blob: blob, filename: filename };
}

function reprintListStep() {
  var tableBody = document.getElementById('reprintListTableBody');
  if (!tableBody) return;

  var selectAllCb = document.getElementById('reprintListSelectAll');
  var searchInput = document.getElementById('reprintListSearchInput');
  var searchClearBtn = document.getElementById('reprintListSearchClearBtn');
  var sendToRequestBtn = document.getElementById('sendToRequestBtn');
  var viewBtn = document.getElementById('reprintListViewBtn');
  var showingRange = document.getElementById('reprintListShowingRange');
  var totalCountEl = document.getElementById('reprintListTotalCount');

  var paginator = createPaginator({
    barId: 'reprintListPaginationBar',
    prefix: 'reprintList',
    getTableBody: function() { return tableBody; },
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.reprintListRowCheckbox:not(:disabled)'));
  }

  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId, 10); });
  }

  function setSingleSelection(targetCb) {
    getCheckboxes().forEach(function(cb) {
      cb.checked = (cb === targetCb) ? targetCb.checked : false;
    });
  }

  function updateSelectionUI() {
    var count = getSelectedCardIds().length;
    if (sendToRequestBtn) sendToRequestBtn.disabled = count === 0;
    if (viewBtn) viewBtn.disabled = count !== 1;
    if (paginator) paginator.updateSelectionCount(count);

    if (selectAllCb) {
      var cbs = getCheckboxes();
      var allChecked = cbs.length > 0 && cbs.every(function(cb) { return cb.checked; });
      var someChecked = cbs.some(function(cb) { return cb.checked; });
      selectAllCb.checked = allChecked;
      selectAllCb.indeterminate = someChecked && !allChecked;
    }
  }

  tableBody.addEventListener('change', function(e) {
    if (e.target.classList.contains('reprintListRowCheckbox')) {
      setSingleSelection(e.target);
      updateSelectionUI();
    }
  });

  var modal = document.getElementById('reprintConfirmModal');
  var countEl = document.getElementById('reprintConfirmCount');
  var submitBtn = document.getElementById('reprintConfirmSubmit');
  var cancelBtn = document.getElementById('reprintConfirmCancel');
  var closeBtn = document.getElementById('reprintConfirmClose');
  var wantEditBtn = document.getElementById('reprintWantEditBtn');
  var pendingCardIds = [];
  var wantEditInFlight = false;

  function openModal(cardIds) {
    pendingCardIds = cardIds;
    if (countEl) countEl.textContent = cardIds.length;
    if (wantEditBtn) {
      wantEditBtn.disabled = cardIds.length !== 1;
      wantEditBtn.title = cardIds.length === 1
        ? 'Edit selected card before request'
        : 'Want to Edit is available for single selection only';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.title = 'Continue without edit and send to request list';
    }
    if (modal) {
      if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
        window.AdarshModalBridge.open('reprintConfirmModal', { overlayClass: 'show' });
      } else {
        modal.classList.add('show');
      }
    }
  }

  function closeModal() {
    if (modal) {
      if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
        window.AdarshModalBridge.close('reprintConfirmModal', { overlayClass: 'show' });
      } else {
        modal.classList.remove('show');
      }
    }
    pendingCardIds = [];
    wantEditInFlight = false;
    if (wantEditBtn) wantEditBtn.disabled = false;
  }

  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeModal();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', function() {
      if (!pendingCardIds.length) return;
      var cardIdsToSubmit = pendingCardIds.slice();
      closeModal();
      ApiClient.post(ENDPOINTS.requestCreate, { card_ids: cardIdsToSubmit })
        .then(function(data) {
          if (data.status === 'ok') {
            showToast(data.message || 'Successfully sent for reprint', 'success');
            refreshStepCounts();
          } else {
            showToast(data.message || 'Could not add to Request List', 'error');
          }
        })
        .catch(function(err) {
          showToast('Request failed. Please try again.', 'error');
          console.error('[ReprintList] request create failed:', err);
        });
    });
  }

  if (wantEditBtn) {
    wantEditBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (wantEditInFlight) return;
      if (pendingCardIds.length !== 1) {
        showToast('Select one card to edit.', 'warning');
        return;
      }
      if (openCardDrawer('edit', pendingCardIds[0])) {
        wantEditInFlight = true;
        wantEditBtn.disabled = true;
        closeModal();
      }
    });
  }

  tableBody.addEventListener('click', function(e) {
    var sendSingle = e.target.closest('.btn-send-to-request-single');
    if (sendSingle) {
      var cardId = parseInt(sendSingle.dataset.cardId, 10);
      if (cardId) openModal([cardId]);
    }
  });

  if (sendToRequestBtn) {
    sendToRequestBtn.addEventListener('click', function() {
      var ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      openModal([ids[0]]);
    });
  }

  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      openCardDrawer('view', ids[0]);
    });
  }

  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchItems(q); }, 300);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      fetchItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchItems(query) {
    ApiClient.get(ENDPOINTS.reprintList + '?q=' + encodeURIComponent(query || '') + '&limit=200')
      .then(function(data) {
        if (data.status !== 'ok') return;
        renderItems(data.items || [], data.total || 0);
      })
      .catch(function(err) {
        console.error('[ReprintList] fetch failed:', err);
      });
  }

  function renderItems(items, total) {
    if (!items.length) {
      updateEmptyTable(tableBody, 'fa-solid fa-id-card', 'No cards in Reprint List', totalCountEl, showingRange);
      updateSelectionUI();
      return;
    }

    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="reprintListRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="w-[120px] px-[1px] py-1 text-center align-middle action-cell"><div class="confirm-action-btns">';
      html += '<button class="btn-send-to-request-single" data-card-id="' + item.card_id + '" title="Send to Request list"><i class="fa-solid fa-check"></i> <span>Request</span></button>';
      html += '</div></td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-' + (item.status || 'pending') + '">' + escapeHtml(item.status_display || '-') + '</span></td>';
      html += '</tr>';
    });

    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = '1-' + items.length;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }
}


function requestListStep() {
  var tableBody = document.getElementById('requestTableBody');
  if (!tableBody) return;

  var selectAllCb = document.getElementById('requestSelectAll');
  var searchInput = document.getElementById('requestSearchInput');
  var searchClearBtn = document.getElementById('requestSearchClearBtn');
  var sendToPrintBtn = document.getElementById('requestSendToPrintBtn');
  var downloadPdfBtn = document.getElementById('requestDownloadPdfBtn');
  var downloadDocxBtn = document.getElementById('requestDownloadDocxBtn');
  var downloadXlsxBtn = document.getElementById('requestDownloadXlsxBtn');
  var downloadImagesBtn = document.getElementById('requestDownloadImagesBtn');
  var rejectBtn = document.getElementById('requestRejectBtn');
  var editBtn = document.getElementById('requestEditBtn');
  var viewBtn = document.getElementById('requestViewBtn');
  var fromDateInput = document.getElementById('requestFromDate');
  var toDateInput = document.getElementById('requestToDate');
  var clearDateFilterBtn = document.getElementById('requestClearDateFilterBtn');
  var showingRange = document.getElementById('requestShowingRange');
  var totalCountEl = document.getElementById('requestTotalCount');
  var currentQuery = '';
  var fetchSeq = 0;
  var suppressDateFetch = false;
  var requestFieldSchema = getFieldSchemaFromHeader(tableBody);
  var requestFromFlatpickr = null;
  var requestToFlatpickr = null;
  var classSectionFilters = initClassSectionFilters({
    prefix: 'request',
    onChange: function() { fetchItems(currentQuery); }
  });

  var paginator = createPaginator({
    barId: 'requestPaginationBar',
    prefix: 'request',
    getTableBody: function() { return tableBody; },
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.requestRowCheckbox:not(:disabled)'));
  }

  function getSelectedRrIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.rrId, 10); });
  }

  function getAllVisibleRrIds() {
    return getCheckboxes().map(function(cb) { return parseInt(cb.closest('tr').dataset.rrId, 10); });
  }

  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId, 10); });
  }

  function getAllVisibleCardIds() {
    return getCheckboxes().map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId, 10); });
  }

  function getTargetCardIdsForDownload() {
    var selected = getSelectedCardIds();
    if (selected.length) return selected;
    return getAllVisibleCardIds();
  }

  function getTargetRrIdsForDownload() {
    var selected = getSelectedRrIds();
    if (selected.length) return selected;
    return getAllVisibleRrIds();
  }

  function updateSelectionUI() {
    var count = getSelectedRrIds().length;
    var totalRows = getCheckboxes().length;
    if (sendToPrintBtn) sendToPrintBtn.disabled = count === 0;
    if (downloadPdfBtn) downloadPdfBtn.disabled = totalRows === 0;
    if (downloadDocxBtn) downloadDocxBtn.disabled = totalRows === 0;
    if (downloadXlsxBtn) downloadXlsxBtn.disabled = totalRows === 0;
    if (downloadImagesBtn) downloadImagesBtn.disabled = totalRows === 0;
    if (rejectBtn) rejectBtn.disabled = count === 0;
    if (editBtn) editBtn.disabled = count !== 1;
    if (viewBtn) viewBtn.disabled = count !== 1;
    if (paginator) paginator.updateSelectionCount(count);

    if (selectAllCb) {
      var cbs = getCheckboxes();
      var allChecked = cbs.length > 0 && cbs.every(function(cb) { return cb.checked; });
      var someChecked = cbs.some(function(cb) { return cb.checked; });
      selectAllCb.checked = allChecked;
      selectAllCb.indeterminate = someChecked && !allChecked;
    }
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
      var checked = this.checked;
      getCheckboxes().forEach(function(cb) { cb.checked = checked; });
      updateSelectionUI();
    });
  }

  tableBody.addEventListener('change', function(e) {
    if (e.target.classList.contains('requestRowCheckbox')) updateSelectionUI();
  });

  if (sendToPrintBtn) {
    sendToPrintBtn.addEventListener('click', async function() {
      var ids = getSelectedRrIds();
      if (!ids.length) return;
      var ok = await showConfirm({
        title: 'Send to Generate List?',
        text: 'Send ' + ids.length + ' item(s) to Generate List and move to Confirmed List?',
        icon: 'fa-solid fa-print',
        confirmLabel: 'Send',
        hideWarning: true,
      });
      if (!ok) return;
      performSendToPrint(ids);
    });
  }

  async function runDownloadAndMove(exportType, rrIds, cardIds) {
    if (!rrIds.length || !cardIds.length) {
      showToast('No requests available to download', 'warning');
      return;
    }

    var selectedRrCount = getSelectedRrIds().length;
    var modeLabel = selectedRrCount > 0 ? 'Selected' : 'All visible';
    var moveCount = rrIds.length;

    var body = {
      card_ids: cardIds,
      status: 'download'
    };

    if (exportType === 'pdf') {
      body.template_id = '';
      body.font_mode = 'auto';
      body.shorten_titles = false;
    }
    if (exportType === 'docx') {
      body.format = 'docx';
      body.template_id = '';
    }

    try {
      if (exportType === 'images') {
        var imgResp = await fetch(ENDPOINTS.downloadImages, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken(),
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify(body)
        });
        var imgData = await imgResp.json();
        if (!imgResp.ok || !imgData.success) {
          throw new Error((imgData && imgData.message) || 'Image download failed');
        }

        var zipFiles = (Array.isArray(imgData.files) && imgData.files.length > 0)
          ? imgData.files
          : (Array.isArray(imgData.zip_files) ? imgData.zip_files : []);
        if (!zipFiles.length) {
          throw new Error('No image ZIP files returned');
        }
        zipFiles.forEach(function(zf) {
          if (zf.download_url) {
            triggerUrlDownload(zf.download_url, zf.filename || 'images.zip');
          } else if (zf.data) {
            var zipBlob = decodeBase64ToBlob(zf.data, 'application/zip');
            triggerBlobDownload(zipBlob, zf.filename || 'images.zip');
          }
        });
      } else {
        var endpointByType = {
          pdf: ENDPOINTS.downloadPdf,
          docx: ENDPOINTS.downloadDocx,
          xlsx: ENDPOINTS.downloadXlsx
        };
        var extByType = { pdf: 'pdf', docx: 'docx', xlsx: 'xlsx' };
        var result = await postJsonForBlob(endpointByType[exportType], body);
        var fallbackName = parseFilenameFromDisposition('', extByType[exportType]);
        if (result.download_url) {
          triggerUrlDownload(result.download_url, result.filename || fallbackName);
        } else {
          triggerBlobDownload(result.blob, result.filename || fallbackName);
        }
      }

      await performSendToPrint(rrIds, {
        successMessage: modeLabel + ' request item(s) downloaded and moved to Confirmed List (' + moveCount + ')',
        silentErrorToast: true,
      });
    } catch (err) {
      showToast((err && err.message) ? err.message : 'Download failed. Please try again.', 'error');
      console.error('[RequestList] download failed:', err);
    }
  }

  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', function() {
      var rrIds = getTargetRrIdsForDownload();
      var cardIds = getTargetCardIdsForDownload();
      runDownloadAndMove('pdf', rrIds, cardIds);
    });
  }

  if (downloadDocxBtn) {
    downloadDocxBtn.addEventListener('click', function() {
      var rrIds = getTargetRrIdsForDownload();
      var cardIds = getTargetCardIdsForDownload();
      runDownloadAndMove('docx', rrIds, cardIds);
    });
  }

  if (downloadXlsxBtn) {
    downloadXlsxBtn.addEventListener('click', function() {
      var rrIds = getTargetRrIdsForDownload();
      var cardIds = getTargetCardIdsForDownload();
      runDownloadAndMove('xlsx', rrIds, cardIds);
    });
  }

  if (downloadImagesBtn) {
    downloadImagesBtn.addEventListener('click', function() {
      var rrIds = getTargetRrIdsForDownload();
      var cardIds = getTargetCardIdsForDownload();
      runDownloadAndMove('images', rrIds, cardIds);
    });
  }

  if (rejectBtn) {
    rejectBtn.addEventListener('click', async function() {
      var ids = getSelectedRrIds();
      if (!ids.length) return;
      var ok = await showConfirm({
        title: 'Reject Requests?',
        text: 'Reject ' + ids.length + ' reprint request(s)? They will be removed from Request List only.',
        icon: 'fa-solid fa-ban',
        confirmLabel: 'Reject',
        hideWarning: true,
      });
      if (!ok) return;
      performReject(ids);
    });
  }

  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      openCardDrawer('view', ids[0]);
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', function() {
      if (!IS_ADMIN_CONTEXT) return;
      var ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      openCardDrawer('edit', ids[0]);
    });
  }

  function removeRowsByIds(rrIds) {
    rrIds.forEach(function(id) {
      var row = tableBody.querySelector('tr[data-rr-id="' + id + '"]');
      if (row) row.remove();
    });

    if (!tableBody.querySelector('tr:not(.no-data-row)')) {
      updateEmptyTable(tableBody, 'fa-solid fa-list-check', 'No reprint requests', totalCountEl, showingRange);
      var pBar = document.getElementById('requestPaginationBar');
      if (pBar) pBar.style.display = 'none';
    } else if (paginator) {
      paginator.paginate();
    }

    updateSelectionUI();
  }

  function performSendToPrint(rrIds, opts) {
    opts = opts || {};
    return ApiClient.post(ENDPOINTS.sendToPrint, { rr_ids: rrIds })
      .then(function(data) {
        if (data.status !== 'ok') {
          throw new Error(data.message || 'Could not print selected requests');
        }
        var successMsg = opts.successMessage || data.message || 'Printed and moved to Confirmed List';
        if (!opts.silentToast) showToast(successMsg, 'success');
        var movedIds = Array.isArray(data.moved_ids) && data.moved_ids.length ? data.moved_ids : rrIds;
        removeRowsByIds(movedIds);
        refreshStepCounts();
        return data;
      })
      .catch(function(err) {
        if (!opts.silentErrorToast) {
          showToast((err && err.message) ? err.message : 'Request failed. Please try again.', 'error');
        }
        console.error('[RequestList] send-to-print failed:', err);
        throw err;
      });
  }

  function performReject(rrIds) {
    ApiClient.post(ENDPOINTS.reject, { rr_ids: rrIds })
      .then(function(data) {
        if (data.status !== 'ok') {
          showToast(data.message || 'Could not reject selected requests', 'error');
          return;
        }
        showToast(data.message || 'Rejected', 'success');
        var rejectedIds = Array.isArray(data.rejected_ids) && data.rejected_ids.length ? data.rejected_ids : rrIds;
        removeRowsByIds(rejectedIds);
        refreshStepCounts();
      })
      .catch(function(err) {
        showToast('Request failed. Please try again.', 'error');
        console.error('[RequestList] reject failed:', err);
      });
  }

  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchItems(q); }, 300);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      fetchItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }


  function initRequestDateFilter() {
    if (!fromDateInput || !toDateInput || typeof flatpickr === 'undefined') return;
    var fpConfig = {
      enableTime: true,
      dateFormat: 'Y-m-d H:i',
      time_24hr: true,
      minuteIncrement: 1,
      allowInput: false,
      onChange: function() {
        if (suppressDateFetch) return;
        setTimeout(function() { fetchItems(currentQuery); }, 40);
      },
      onClose: function(_selected, _dateStr, instance) {
        if (!instance || !instance.calendarContainer) return;
        var timeInputs = instance.calendarContainer.querySelectorAll('.flatpickr-time input');
        timeInputs.forEach(function(inp) {
          inp.addEventListener('change', function() {
            setTimeout(function() { fetchItems(currentQuery); }, 40);
          }, { once: true });
        });
      }
    };
    requestFromFlatpickr = flatpickr(fromDateInput, fpConfig);
    requestToFlatpickr = flatpickr(toDateInput, fpConfig);
    // Always show date filter
    fromDateInput.parentElement.style.display = '';
    toDateInput.parentElement.style.display = '';
  }

  initRequestDateFilter();

  if (clearDateFilterBtn) {
    clearDateFilterBtn.addEventListener('click', function() {
      suppressDateFetch = true;
      if (requestFromFlatpickr) requestFromFlatpickr.clear();
      if (requestToFlatpickr) requestToFlatpickr.clear();
      if (fromDateInput) fromDateInput.value = '';
      if (toDateInput) toDateInput.value = '';
      fetchItems(currentQuery);
      setTimeout(function() { suppressDateFetch = false; }, 0);
    });
  }

  function fetchItems(query) {
    currentQuery = query || '';
    var mySeq = ++fetchSeq;
    var url = ENDPOINTS.requestList + '?q=' + encodeURIComponent(currentQuery) + '&limit=200';
    var classFilter = classSectionFilters.getClassFilter();
    var sectionFilter = classSectionFilters.getSectionFilter();
    if (classFilter) {
      url += '&class=' + encodeURIComponent(classFilter);
    }
    if (sectionFilter) {
      url += '&section=' + encodeURIComponent(sectionFilter);
    }
    if (fromDateInput && fromDateInput.value) {
      url += '&from=' + encodeURIComponent(fromDateInput.value);
    }
    if (toDateInput && toDateInput.value) {
      url += '&to=' + encodeURIComponent(toDateInput.value);
    }

    ApiClient.get(url)
      .then(function(data) {
        if (mySeq !== fetchSeq) return;
        if (data.status !== 'ok') return;
        renderItems(data.items || [], data.total || 0);
      })
      .catch(function(err) {
        if (mySeq !== fetchSeq) return;
        console.error('[RequestList] fetch failed:', err);
      });
  }

  function renderItems(items, total) {
    if (!items.length) {
      updateEmptyTable(tableBody, 'fa-solid fa-list-check', 'No items in Request List', totalCountEl, showingRange);
      updateSelectionUI();
      return;
    }

    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-rr-id="' + item.rr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="requestRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields, requestFieldSchema);
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">' + escapeHtml(item.requested_at || '-') + '</td>';
      html += '</tr>';
    });

    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = '1-' + items.length;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }

  updateSelectionUI();
}


function confirmedListStep() {
  var tableBody = document.getElementById('confirmedTableBody');
  if (!tableBody) return;

  var selectAllCb = document.getElementById('confirmedSelectAll');
  var searchInput = document.getElementById('confirmedSearchInput');
  var searchClearBtn = document.getElementById('confirmedSearchClearBtn');
  var fromDateInput = document.getElementById('confirmedFromDate');
  var toDateInput = document.getElementById('confirmedToDate');
  var clearDateFilterBtn = document.getElementById('confirmedClearDateFilterBtn');
  var downloadPdfBtn = document.getElementById('confirmedDownloadPdfBtn');
  var downloadDocxBtn = document.getElementById('confirmedDownloadDocxBtn');
  var downloadXlsxBtn = document.getElementById('confirmedDownloadXlsxBtn');
  var downloadImagesBtn = document.getElementById('confirmedDownloadImagesBtn');
  var editBtn = document.getElementById('confirmedEditBtn');
  var viewBtn = document.getElementById('confirmedViewBtn');
  var showingRange = document.getElementById('confirmedShowingRange');
  var totalCountEl = document.getElementById('confirmedTotalCount');
  var currentQuery = '';
  var fetchSeq = 0;
  var suppressDateFetch = false;
  var confirmedFieldSchema = getFieldSchemaFromHeader(tableBody);
  var confirmedFromFlatpickr = null;
  var confirmedToFlatpickr = null;
  var classSectionFilters = initClassSectionFilters({
    prefix: 'confirmed',
    onChange: function() { fetchItems(currentQuery); }
  });

  var paginator = createPaginator({
    barId: 'confirmedPaginationBar',
    prefix: 'confirmed',
    getTableBody: function() { return tableBody; },
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.confirmedRowCheckbox:not(:disabled)'));
  }

  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId, 10); });
  }

  function getAllVisibleCardIds() {
    return getCheckboxes().map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId, 10); });
  }

  function getTargetCardIdsForDownload() {
    var selected = getSelectedCardIds();
    if (selected.length) return selected;
    return getAllVisibleCardIds();
  }

  function updateSelectionUI() {
    var count = getCheckboxes().filter(function(cb) { return cb.checked; }).length;
    var totalRows = getCheckboxes().length;
    if (viewBtn) viewBtn.disabled = count !== 1;
    if (downloadPdfBtn) downloadPdfBtn.disabled = totalRows === 0;
    if (downloadDocxBtn) downloadDocxBtn.disabled = totalRows === 0;
    if (downloadXlsxBtn) downloadXlsxBtn.disabled = totalRows === 0;
    if (downloadImagesBtn) downloadImagesBtn.disabled = totalRows === 0;
    if (editBtn) editBtn.disabled = count !== 1;
    if (paginator) paginator.updateSelectionCount(count);

    if (selectAllCb) {
      var cbs = getCheckboxes();
      var allChecked = cbs.length > 0 && cbs.every(function(cb) { return cb.checked; });
      var someChecked = cbs.some(function(cb) { return cb.checked; });
      selectAllCb.checked = allChecked;
      selectAllCb.indeterminate = someChecked && !allChecked;
    }
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
      var checked = this.checked;
      getCheckboxes().forEach(function(cb) { cb.checked = checked; });
      updateSelectionUI();
    });
  }

  function removeRowsByIds(rrIds) {
    rrIds.forEach(function(id) {
      var row = tableBody.querySelector('tr[data-rr-id="' + id + '"]');
      if (row) row.remove();
    });

    if (!tableBody.querySelector('tr:not(.no-data-row)')) {
      updateEmptyTable(tableBody, 'fa-solid fa-clipboard-check', 'No items in Confirmed List', totalCountEl, showingRange);
      var pBar = document.getElementById('confirmedPaginationBar');
      if (pBar) pBar.style.display = 'none';
    } else if (paginator) {
      paginator.paginate();
    }

    updateSelectionUI();
  }

  function performRetrieve(rrIds) {
    ApiClient.post(ENDPOINTS.retrieve, { rr_ids: rrIds })
      .then(function(data) {
        if (data.status !== 'ok') {
          showToast(data.message || 'Could not retrieve selected requests', 'error');
          return;
        }
        var movedIds = Array.isArray(data.moved_ids) && data.moved_ids.length ? data.moved_ids : rrIds;
        removeRowsByIds(movedIds);
        refreshStepCounts();
        showToast(data.message || 'Retrieved back to Request List', 'success');
      })
      .catch(function(err) {
        showToast((err && err.message) ? err.message : 'Request failed. Please try again.', 'error');
        console.error('[ConfirmedList] retrieve failed:', err);
      });
  }

  tableBody.addEventListener('change', function(e) {
    if (e.target.classList.contains('confirmedRowCheckbox')) updateSelectionUI();
  });

  tableBody.addEventListener('click', function(e) {
    var retrieveSingle = e.target.closest('.btn-retrieve-single');
    if (retrieveSingle) {
      var rrId = parseInt(retrieveSingle.dataset.rrId, 10);
      if (rrId) performRetrieve([rrId]);
    }
  });

  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      openCardDrawer('view', ids[0]);
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', function() {
      if (!IS_ADMIN_CONTEXT) return;
      var ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      openCardDrawer('edit', ids[0]);
    });
  }

  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchItems(q); }, 300);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      fetchItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function initConfirmedDateFilter() {
    if (!fromDateInput || !toDateInput || typeof flatpickr === 'undefined') return;
    var fpConfig = {
      enableTime: true,
      dateFormat: 'Y-m-d H:i',
      time_24hr: true,
      minuteIncrement: 1,
      allowInput: false,
      onChange: function() {
        if (suppressDateFetch) return;
        setTimeout(function() { fetchItems(currentQuery); }, 40);
      },
      onClose: function(_selected, _dateStr, instance) {
        if (!instance || !instance.calendarContainer) return;
        var timeInputs = instance.calendarContainer.querySelectorAll('.flatpickr-time input');
        timeInputs.forEach(function(inp) {
          inp.addEventListener('change', function() {
            setTimeout(function() { fetchItems(currentQuery); }, 40);
          }, { once: true });
        });
      }
    };
    confirmedFromFlatpickr = flatpickr(fromDateInput, fpConfig);
    confirmedToFlatpickr = flatpickr(toDateInput, fpConfig);
  }

  initConfirmedDateFilter();

  if (clearDateFilterBtn) {
    clearDateFilterBtn.addEventListener('click', function() {
      suppressDateFetch = true;
      if (confirmedFromFlatpickr) confirmedFromFlatpickr.clear();
      if (confirmedToFlatpickr) confirmedToFlatpickr.clear();
      if (fromDateInput) fromDateInput.value = '';
      if (toDateInput) toDateInput.value = '';
      fetchItems(currentQuery);
      setTimeout(function() { suppressDateFetch = false; }, 0);
    });
  }

  async function fetchImageZip(body, retried) {
      retried = !!retried;
      var resp = await fetch(ENDPOINTS.downloadImages, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken(),
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify(body)
      });

      var data = await resp.json().catch(function() { return {}; });
      if (!resp.ok || !data.success) {
        var message = (data && data.message) || 'Image download failed';
        if (!retried && isSessionExpiredError(resp.status, message)) {
          var freshToken = await refreshSessionToken();
          if (freshToken) {
            return fetchImageZip(body, true);
          }
        }
        throw new Error(message);
      }
      return data;
  }

  function runConfirmedDownload(exportType) {
    var cardIds = getTargetCardIdsForDownload();
    if (!cardIds.length) {
      showToast('No cards available to download', 'warning');
      return;
    }

    var body = {
      card_ids: cardIds,
      status: 'download'
    };

    if (exportType === 'pdf') {
      body.template_id = '';
      body.font_mode = 'auto';
      body.shorten_titles = false;
    }
    if (exportType === 'docx') {
      body.format = 'docx';
      body.template_id = '';
    }

    var downloadPromise;
    if (exportType === 'images') {
      downloadPromise = fetchImageZip(body).then(function(imgData) {
        var zipFiles = (Array.isArray(imgData.files) && imgData.files.length > 0)
          ? imgData.files
          : (Array.isArray(imgData.zip_files) ? imgData.zip_files : []);
        if (!zipFiles.length) throw new Error('No image ZIP files returned');
        zipFiles.forEach(function(zf) {
          if (zf.download_url) {
            triggerUrlDownload(zf.download_url, zf.filename || 'images.zip');
          } else if (zf.data) {
            var zipBlob = decodeBase64ToBlob(zf.data, 'application/zip');
            triggerBlobDownload(zipBlob, zf.filename || 'images.zip');
          }
        });
      });
    } else {
      var endpointByType = {
        pdf: ENDPOINTS.downloadPdf,
        docx: ENDPOINTS.downloadDocx,
        xlsx: ENDPOINTS.downloadXlsx
      };
      downloadPromise = postJsonForBlob(endpointByType[exportType], body).then(function(result) {
        if (result.download_url) {
          triggerUrlDownload(result.download_url, result.filename || 'export');
        } else {
          triggerBlobDownload(result.blob, result.filename || 'export');
        }
      });
    }

    downloadPromise
      .then(function() {
        showToast((getSelectedCardIds().length ? 'Selected' : 'All visible') + ' confirmed cards downloaded', 'success');
      })
      .catch(function(err) {
        showToast((err && err.message) ? err.message : 'Download failed. Please try again.', 'error');
        console.error('[ConfirmedList] download failed:', err);
      });
  }

  if (downloadPdfBtn) downloadPdfBtn.addEventListener('click', function() { runConfirmedDownload('pdf'); });
  if (downloadDocxBtn) downloadDocxBtn.addEventListener('click', function() { runConfirmedDownload('docx'); });
  if (downloadXlsxBtn) downloadXlsxBtn.addEventListener('click', function() { runConfirmedDownload('xlsx'); });
  if (downloadImagesBtn) downloadImagesBtn.addEventListener('click', function() { runConfirmedDownload('images'); });

  function fetchItems(query) {
    currentQuery = query || '';
    var mySeq = ++fetchSeq;
    var url = ENDPOINTS.confirmedList + '?q=' + encodeURIComponent(currentQuery) + '&limit=200';
    var classFilter = classSectionFilters.getClassFilter();
    var sectionFilter = classSectionFilters.getSectionFilter();
    if (classFilter) {
      url += '&class=' + encodeURIComponent(classFilter);
    }
    if (sectionFilter) {
      url += '&section=' + encodeURIComponent(sectionFilter);
    }
    if (fromDateInput && fromDateInput.value) {
      url += '&from=' + encodeURIComponent(fromDateInput.value);
    }
    if (toDateInput && toDateInput.value) {
      url += '&to=' + encodeURIComponent(toDateInput.value);
    }
    ApiClient.get(url)
      .then(function(data) {
        if (mySeq !== fetchSeq) return;
        if (data.status !== 'ok') return;
        renderItems(data.items || [], data.total || 0);
      })
      .catch(function(err) {
        if (mySeq !== fetchSeq) return;
        console.error('[ConfirmedList] fetch failed:', err);
      });
  }

  function renderItems(items, total) {
    if (!items.length) {
      updateEmptyTable(tableBody, 'fa-solid fa-clipboard-check', 'No items in Confirmed List', totalCountEl, showingRange);
      updateSelectionUI();
      return;
    }

    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-rr-id="' + item.rr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="confirmedRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields, confirmedFieldSchema);
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">' + escapeHtml(item.confirmed_at || '-') + '</td>';
      html += '<td class="w-[74px] px-[1px] py-1 text-center align-middle"><button class="row-action-btn retrieve-row-btn btn-retrieve-single" data-rr-id="' + item.rr_id + '" data-card-id="' + item.card_id + '" title="Retrieve back to Request list">Retrieve</button></td>';
      html += '</tr>';
    });

    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = '1-' + items.length;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }

  updateSelectionUI();
}

function initReprintCardsPage() {
  reprintListStep();
  requestListStep();
  confirmedListStep();
}

window.ReprintCards = window.ReprintCards || {};
window.ReprintCards.reinitialize = initReprintCardsPage;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReprintCardsPage);
} else {
  initReprintCardsPage();
}

document.body.addEventListener('htmx:afterSwap', function(evt) {
  if (!evt || !evt.target) return;
  if (evt.target.matches && evt.target.matches('main.reprint-cards-page')) {
    initReprintCardsPage();
  }
});

})();
