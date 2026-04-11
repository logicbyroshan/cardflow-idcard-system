(function () {
    'use strict';

    var WRAPPER_CLASS = 'unified-select-dropdown';
    var ENHANCED_ATTR = 'data-unified-dropdown-enhanced';
    var SKIP_SELECTOR = '[data-native-select="1"], .native-select, [multiple], [size]:not([size="1"])';
    var SELECTOR = 'select:not([multiple]):not([data-native-select="1"]):not(.native-select)';
    var wrappers = [];
    var observer = null;

    function uid(prefix) {
        return (prefix || 'usd') + '-' + Math.random().toString(36).slice(2, 10);
    }

    function optionSignature(selectEl) {
        var parts = [];
        var options = selectEl.options || [];
        for (var i = 0; i < options.length; i += 1) {
            var opt = options[i];
            parts.push([
                String(opt.value || ''),
                String(opt.text || ''),
                opt.disabled ? '1' : '0',
                opt.selected ? '1' : '0'
            ].join('::'));
        }
        parts.push('disabled=' + (selectEl.disabled ? '1' : '0'));
        return parts.join('||');
    }

    function selectedLabel(selectEl) {
        var selected = selectEl.options[selectEl.selectedIndex];
        if (!selected) return '';
        return String(selected.text || '').trim();
    }

    function shouldConvert(selectEl) {
        if (!(selectEl instanceof HTMLSelectElement)) return false;
        if (selectEl.getAttribute(ENHANCED_ATTR) === '1') return false;
        if (selectEl.matches(SKIP_SELECTOR) || selectEl.closest(SKIP_SELECTOR)) return false;

        var sizeAttr = selectEl.getAttribute('size');
        if (sizeAttr && sizeAttr !== '1') return false;

        return true;
    }

    function closeAll(exceptWrapper) {
        wrappers.forEach(function (entry) {
            if (!entry || !entry.wrapper) return;
            if (exceptWrapper && entry.wrapper === exceptWrapper) return;
            entry.wrapper.classList.remove('open');
            entry.button.setAttribute('aria-expanded', 'false');
        });
    }

    function syncEntry(entry, forceRebuild) {
        if (!entry || !entry.selectEl || !entry.wrapper) return;
        if (!document.body.contains(entry.selectEl)) return;

        var currentSig = optionSignature(entry.selectEl);
        if (!forceRebuild && currentSig === entry.signature) {
            var label = selectedLabel(entry.selectEl);
            if (entry.labelEl.textContent !== label) {
                entry.labelEl.textContent = label;
            }
            entry.button.disabled = !!entry.selectEl.disabled;
            return;
        }

        entry.signature = currentSig;
        entry.optionsEl.innerHTML = '';

        var options = entry.selectEl.options || [];
        for (var i = 0; i < options.length; i += 1) {
            var opt = options[i];
            var row = document.createElement('div');
            row.className = 'dropdown-option';
            if (opt.selected) row.classList.add('selected');
            if (opt.disabled) row.classList.add('disabled');
            row.setAttribute('data-value', String(opt.value || ''));
            row.textContent = String(opt.text || '').trim();
            entry.optionsEl.appendChild(row);
        }

        entry.labelEl.textContent = selectedLabel(entry.selectEl);
        entry.button.disabled = !!entry.selectEl.disabled;
    }

    function applySizing(selectEl, wrapper) {
        var computed = window.getComputedStyle(selectEl);
        var compactContext = !!selectEl.closest(
            '.notif-actions-bar, .notif-actions-left, .notif-actions-right, .action-bar, .action-left, .action-right, .wa-action-bar, .wa-bulk-action-bar, .search-filter-group, .pagination-right, .wa-filter-row'
        );

        var parentRect = selectEl.parentElement ? selectEl.parentElement.getBoundingClientRect() : null;
        var selectRect = selectEl.getBoundingClientRect();
        var fillsParent = !!(parentRect && parentRect.width > 0 && selectRect.width >= (parentRect.width - 2));
        var isFullWidth = false;

        if (!compactContext && fillsParent) isFullWidth = true;
        if (selectEl.classList.contains('panel-form-select')) isFullWidth = true;
        if (selectEl.classList.contains('contact-status-select')) isFullWidth = true;
        if (selectEl.classList.contains('center-modal-select')) isFullWidth = true;
        if (selectEl.classList.contains('session-select')) isFullWidth = true;
        if (selectEl.closest('.wa-form-group')) isFullWidth = true;
        if (selectEl.closest('.form-group')) isFullWidth = true;

        if (compactContext) isFullWidth = false;

        if (isFullWidth) {
            wrapper.style.display = 'block';
            wrapper.style.width = '100%';
            wrapper.style.minWidth = '0';
        } else {
            wrapper.style.display = 'inline-block';

            var minWidth = computed.minWidth;
            if (minWidth && minWidth !== '0px' && minWidth !== 'auto') {
                wrapper.style.minWidth = minWidth;
            } else {
                var width = computed.width;
                if (width && width !== '0px' && width !== 'auto') {
                    wrapper.style.minWidth = width;
                }
            }
        }

        if (/(rowsperpage|rows|per_page)/i.test(selectEl.id || '')) {
            wrapper.classList.add('rows-dropdown');
        }
    }

    function buildEntry(selectEl) {
        if (!selectEl.id) {
            selectEl.id = uid('usd-select');
        }

        var wrapper = document.createElement('div');
        wrapper.className = 'custom-dropdown ' + WRAPPER_CLASS;
        wrapper.id = selectEl.id + '__dropdown';
        wrapper.style.display = 'inline-block';

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'dropdown-toggle';
        button.setAttribute('aria-expanded', 'false');
        button.style.width = '100%';
        button.style.justifyContent = 'space-between';
        button.style.textAlign = 'left';

        var labelEl = document.createElement('span');
        labelEl.id = selectEl.id + '__selectedText';
        button.appendChild(labelEl);

        var icon = document.createElement('i');
        icon.className = 'fa-solid fa-chevron-down';
        button.appendChild(icon);

        var optionsEl = document.createElement('div');
        optionsEl.className = 'dropdown-options';
        optionsEl.id = selectEl.id + '__options';

        wrapper.appendChild(button);
        wrapper.appendChild(optionsEl);

        selectEl.parentNode.insertBefore(wrapper, selectEl);
        selectEl.style.display = 'none';
        selectEl.setAttribute(ENHANCED_ATTR, '1');

        applySizing(selectEl, wrapper);

        var entry = {
            selectEl: selectEl,
            wrapper: wrapper,
            button: button,
            labelEl: labelEl,
            optionsEl: optionsEl,
            signature: ''
        };

        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled) return;
            var willOpen = !wrapper.classList.contains('open');
            closeAll(wrapper);
            wrapper.classList.toggle('open', willOpen);
            button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            if (willOpen) syncEntry(entry, false);
        });

        optionsEl.addEventListener('click', function (event) {
            var optionNode = event.target.closest('.dropdown-option');
            if (!optionNode || optionNode.classList.contains('disabled')) return;

            var nextValue = optionNode.getAttribute('data-value') || '';
            if (selectEl.value !== nextValue) {
                selectEl.value = nextValue;
            }

            syncEntry(entry, true);
            wrapper.classList.remove('open');
            button.setAttribute('aria-expanded', 'false');

            var changeEvent = new Event('change', { bubbles: true });
            var inputEvent = new Event('input', { bubbles: true });
            selectEl.dispatchEvent(inputEvent);
            selectEl.dispatchEvent(changeEvent);
        });

        selectEl.addEventListener('change', function () {
            syncEntry(entry, true);
        });

        syncEntry(entry, true);
        wrappers.push(entry);
    }

    function convertInRoot(root) {
        if (!root) return;

        if (root.matches && root.matches(SELECTOR) && shouldConvert(root)) {
            buildEntry(root);
        }

        if (!root.querySelectorAll) return;
        var selects = root.querySelectorAll(SELECTOR);
        selects.forEach(function (selectEl) {
            if (!shouldConvert(selectEl)) return;
            buildEntry(selectEl);
        });
    }

    function pruneDetachedEntries() {
        wrappers = wrappers.filter(function (entry) {
            if (!entry || !entry.selectEl || !entry.wrapper) return false;
            var stillExists = document.body.contains(entry.selectEl) && document.body.contains(entry.wrapper);
            if (!stillExists) return false;
            return true;
        });
    }

    function syncAll() {
        pruneDetachedEntries();
        wrappers.forEach(function (entry) {
            syncEntry(entry, false);
        });
    }

    function initObserver() {
        if (observer || !document.body) return;

        observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (!(node instanceof HTMLElement)) return;
                    convertInRoot(node);
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    function bindGlobalClosers() {
        document.addEventListener('click', function (event) {
            var target = event.target;
            if (target && target.closest('.' + WRAPPER_CLASS)) return;
            closeAll(null);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                closeAll(null);
            }
        });

        document.body.addEventListener('htmx:afterSwap', function (event) {
            convertInRoot(event.target || document);
            syncAll();
        });
    }

    function init() {
        convertInRoot(document);
        initObserver();
        bindGlobalClosers();

        // Keep custom controls synced when scripts change select values.
        window.setInterval(syncAll, 250);

        window.syncUnifiedSelectDropdowns = syncAll;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
