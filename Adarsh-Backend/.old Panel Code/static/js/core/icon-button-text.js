(function () {
    'use strict';

    var APPLIED_ATTR = 'data-icon-label-applied';
    var BUTTON_CLASS = 'icon-btn-with-auto-label';
    var LABEL_CLASS = 'icon-btn-auto-label';
    var SKIP_SELECTOR = '[data-icon-label-skip="1"], .icon-label-skip';
    var FORCE_SELECTOR = '[data-icon-label-force="1"], .icon-label-force';

    var ICON_LABEL_MAP = {
        'fa-angles-left': 'First',
        'fa-chevron-left': 'Prev',
        'fa-chevron-right': 'Next',
        'fa-angles-right': 'Last',
        'fa-xmark': 'Close',
        'fa-times': 'Close',
        'fa-trash': 'Delete',
        'fa-pen': 'Edit',
        'fa-pencil': 'Edit',
        'fa-floppy-disk': 'Save',
        'fa-download': 'Download',
        'fa-upload': 'Upload',
        'fa-plus': 'Add',
        'fa-minus': 'Remove',
        'fa-check': 'Confirm',
        'fa-circle-info': 'Info',
        'fa-copy': 'Copy',
        'fa-magnifying-glass': 'Search',
        'fa-bars': 'Menu',
        'fa-eye': 'View',
        'fa-rotate': 'Refresh'
    };

    function ensureStyles() {
        if (document.getElementById('iconBtnAutoLabelStyles')) return;

        var style = document.createElement('style');
        style.id = 'iconBtnAutoLabelStyles';
        style.textContent = [
            '.' + BUTTON_CLASS + '{display:inline-flex !important;align-items:center;justify-content:center;gap:6px;width:auto !important;min-width:56px;padding-left:10px !important;padding-right:10px !important;}',
            '.' + BUTTON_CLASS + ' .' + LABEL_CLASS + '{font-size:12px;font-weight:600;line-height:1;white-space:nowrap;}',
            '.' + BUTTON_CLASS + ' i{font-size:12px;}'
        ].join('');

        document.head.appendChild(style);
    }

    function normalizeLabel(rawLabel) {
        if (!rawLabel) return '';

        var label = String(rawLabel).replace(/\s+/g, ' ').trim();
        if (!label) return '';

        var lower = label.toLowerCase();
        if (lower.indexOf('toggle sidebar') !== -1 || lower.indexOf('toggle navigation') !== -1) return 'Menu';
        if (lower.indexOf('first page') !== -1) return 'First';
        if (lower.indexOf('previous page') !== -1) return 'Prev';
        if (lower.indexOf('next page') !== -1) return 'Next';
        if (lower.indexOf('last page') !== -1) return 'Last';
        if (lower.indexOf('clear search') !== -1) return 'Clear';
        if (lower.indexOf('mark as read') !== -1) return 'Mark';
        if (lower.indexOf('close') !== -1) return 'Close';

        return label.replace(/\.$/, '');
    }

    function hasVisibleText(button) {
        var clone = button.cloneNode(true);
        var removable = clone.querySelectorAll('i,svg,img,use,.sr-only,.visually-hidden,.' + LABEL_CLASS);
        removable.forEach(function (node) {
            node.remove();
        });

        var text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        return text.length > 0;
    }

    function getIconToken(button) {
        var icon = button.querySelector('i[class*="fa-"],svg[class*="fa-"]');
        if (!icon) return '';

        var skipTokens = {
            'fa-solid': true,
            'fa-regular': true,
            'fa-brands': true,
            'fa-fw': true,
            'fa-xs': true,
            'fa-sm': true,
            'fa-lg': true,
            'fa-xl': true,
            'fa-2x': true,
            'fa-3x': true,
            'fa-4x': true,
            'fa-5x': true,
            'fa-spin': true,
            'fa-spin-pulse': true
        };

        var classes = Array.prototype.slice.call(icon.classList || []);
        for (var i = 0; i < classes.length; i += 1) {
            var token = classes[i];
            if (token.indexOf('fa-') === 0 && !skipTokens[token]) {
                return token;
            }
        }

        return '';
    }

    function deriveLabel(button) {
        var explicit = normalizeLabel(
            button.getAttribute('data-btn-label') ||
            button.getAttribute('aria-label') ||
            button.getAttribute('title')
        );
        if (explicit) return explicit;

        var iconToken = getIconToken(button);
        if (iconToken && ICON_LABEL_MAP[iconToken]) {
            return ICON_LABEL_MAP[iconToken];
        }

        return '';
    }

    function shouldAutoLabel(button) {
        if (!(button instanceof HTMLElement)) return false;
        if (button.matches(FORCE_SELECTOR) || button.closest(FORCE_SELECTOR)) return true;

        // Keep auto labels on pagination controls only.
        if (button.classList.contains('pagination-btn')) return true;
        return false;
    }

    function processButton(button) {
        if (!(button instanceof HTMLElement)) return;
        if (button.tagName !== 'BUTTON') return;
        if (button.getAttribute(APPLIED_ATTR) === '1') return;
        if (button.matches(SKIP_SELECTOR) || button.closest(SKIP_SELECTOR)) return;
        if (!button.querySelector('i,svg')) return;
        if (!shouldAutoLabel(button)) return;

        if (hasVisibleText(button)) {
            button.setAttribute(APPLIED_ATTR, '1');
            return;
        }

        var label = deriveLabel(button);
        if (!label) return;

        var labelNode = document.createElement('span');
        labelNode.className = LABEL_CLASS;
        labelNode.textContent = label;

        button.classList.add(BUTTON_CLASS);
        button.appendChild(labelNode);
        button.setAttribute(APPLIED_ATTR, '1');
    }

    function processRoot(root) {
        if (!root) return;

        if (root.tagName === 'BUTTON') {
            processButton(root);
        }

        if (!root.querySelectorAll) return;

        var buttons = root.querySelectorAll('button');
        buttons.forEach(processButton);
    }

    function init() {
        ensureStyles();
        processRoot(document);

        if (!document.body) return;

        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (!(node instanceof HTMLElement)) return;
                    processRoot(node);
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });

        document.body.addEventListener('htmx:afterSwap', function (event) {
            processRoot(event.target || document);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
