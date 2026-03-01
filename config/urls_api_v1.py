"""
API v1 URL Configuration
========================

All NEW API endpoints should be added here under /api/v1/<resource>/.

Existing endpoints (added before versioning was introduced) live in their
respective app URL confs (core/urls.py, client/urls.py, etc.) and are
accessible at /api/<resource>/ for backward compatibility with the frontend JS.

Mount points:
  config/urls.py       → path('api/v1/', include('config.urls_api_v1'))
  config/urls_panel.py → path('api/v1/', include('config.urls_api_v1'))

Naming convention:
  URL name:  v1:<resource>_<action>   e.g. v1:cards_list
  URL path:  api/v1/<resource>/       e.g. api/v1/cards/

Usage in Python:
  from django.urls import reverse
  url = reverse('v1:cards_list')

Usage in JS (api.js helper):
  const url = `/api/v1/cards/`;
"""
from django.urls import path

app_name = 'v1'

# ─────────────────────────────────────────────────────────────────────────────
# Add new versioned endpoints below.
# Example:
#   from core.views.some_api import some_new_view
#   path('cards/', some_new_view, name='cards_list'),
# ─────────────────────────────────────────────────────────────────────────────

urlpatterns = [
    # Versioned endpoints — add new API routes here
]
