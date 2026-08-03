(function () {
  'use strict';

  const LEGACY_PREFIX_TO_MODERN = {
    fas: 'fa-solid',
    far: 'fa-regular',
    fal: 'fa-light',
    fad: 'fa-duotone',
    fat: 'fa-thin',
    fab: 'fa-brands'
  };

  const LEGACY_STYLE_PREFIXES = Object.keys(LEGACY_PREFIX_TO_MODERN);
  const MODERN_STYLE_PREFIXES = ['fa-solid', 'fa-regular', 'fa-light', 'fa-duotone', 'fa-thin', 'fa-brands'];

  const GLOBAL_ICON_REPLACEMENTS = {
    'fa-times': 'fa-xmark',
    'fa-close': 'fa-xmark',
    'fa-remove': 'fa-xmark',
    'fa-search': 'fa-magnifying-glass',
    'fa-edit': 'fa-pen',
    'fa-pencil-alt': 'fa-pen',
    'fa-trash-alt': 'fa-trash'
  };

  function hasIconClass(element) {
    return Array.from(element.classList).some((className) => className.startsWith('fa-'));
  }

  function hasModernPrefix(element) {
    return MODERN_STYLE_PREFIXES.some((prefix) => element.classList.contains(prefix));
  }

  function applyReplacement(element, sourceClass, targetClass) {
    if (!element.classList.contains(sourceClass)) {
      return;
    }
    element.classList.remove(sourceClass);
    if (!element.classList.contains(targetClass)) {
      element.classList.add(targetClass);
    }
  }

  function isSearchContext(element, contextText) {
    if (element.closest('.search-box, .notif-search-box, .global-search-btn, .search-control')) {
      return true;
    }
    return /\b(search|find|lookup)\b/.test(contextText);
  }

  function isCloseContext(contextText) {
    return /\b(close|cancel|dismiss|hide)\b/.test(contextText);
  }

  function isEditContext(contextText) {
    return /\b(edit|modify|update)\b/.test(contextText);
  }

  function isDeleteContext(contextText) {
    return /\b(delete|remove|trash|clear)\b/.test(contextText);
  }

  function getContextText(element) {
    const host = element.closest('button, a, [role="button"], .btn, .dropdown-option, label');
    if (!host) {
      return '';
    }

    return [host.getAttribute('title'), host.getAttribute('aria-label'), host.textContent]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function normalizeIconElement(element) {
    if (!(element instanceof HTMLElement) || element.tagName !== 'I') {
      return;
    }

    if (!hasIconClass(element) && !LEGACY_STYLE_PREFIXES.some((prefix) => element.classList.contains(prefix))) {
      return;
    }

    let mappedModernPrefix = '';

    LEGACY_STYLE_PREFIXES.forEach((prefix) => {
      if (element.classList.contains(prefix)) {
        element.classList.remove(prefix);
        if (!mappedModernPrefix) {
          mappedModernPrefix = LEGACY_PREFIX_TO_MODERN[prefix] || '';
        }
      }
    });

    if (mappedModernPrefix && !hasModernPrefix(element)) {
      element.classList.add(mappedModernPrefix);
    }

    if ((element.classList.contains('fa') || hasIconClass(element)) && !hasModernPrefix(element)) {
      element.classList.add('fa-solid');
    }

    Object.entries(GLOBAL_ICON_REPLACEMENTS).forEach(([sourceClass, targetClass]) => {
      applyReplacement(element, sourceClass, targetClass);
    });

    const contextText = getContextText(element);

    if (element.classList.contains('fa-search') && isSearchContext(element, contextText)) {
      applyReplacement(element, 'fa-search', 'fa-magnifying-glass');
    }

    if (element.classList.contains('fa-times') && isCloseContext(contextText)) {
      applyReplacement(element, 'fa-times', 'fa-xmark');
    }

    if (element.classList.contains('fa-pen-to-square') && isEditContext(contextText)) {
      applyReplacement(element, 'fa-pen-to-square', 'fa-pen');
    }

    if (element.classList.contains('fa-trash-can') && isDeleteContext(contextText)) {
      applyReplacement(element, 'fa-trash-can', 'fa-trash');
    }
  }

  function normalizeWithin(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return;
    }

    if (root instanceof HTMLElement && root.tagName === 'I') {
      normalizeIconElement(root);
    }

    root.querySelectorAll('i').forEach(normalizeIconElement);
  }

  function observeChanges() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }
          normalizeWithin(node);
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    normalizeWithin(document);
    observeChanges();

    document.body.addEventListener('htmx:afterSwap', (event) => {
      normalizeWithin(event.target || document);
    });

    document.body.addEventListener('htmx:afterSettle', (event) => {
      normalizeWithin(event.target || document);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
