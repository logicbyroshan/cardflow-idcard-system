# Service Layer Architecture

## Overview

This document describes the refactored architecture using a **Service Layer Pattern** to separate business logic from views.

## Folder Structure

```
core/
├── models.py                 # Django models (unchanged)
├── admin.py                  # Django admin (unchanged)
├── urls.py                   # URL routing (unchanged)
├── services/                 # NEW: Business logic layer
│   ├── __init__.py          # Exports all services
│   ├── base.py              # ServiceResult, BaseService utilities
│   ├── permission_service.py # Role-based permission checking
│   ├── image_service.py     # Image upload, validation, folder management
│   ├── client_service.py    # Client CRUD operations
│   ├── staff_service.py     # Staff CRUD operations
│   ├── idcard_service.py    # ID Card & Table CRUD, status management
│   ├── export_service.py    # XLSX, ZIP export
│   └── import_service.py    # Bulk upload from Excel/CSV
├── views/                    # HTTP handlers (thin views)
│   ├── __init__.py
│   ├── base.py              # Decorators, common utilities
│   ├── auth.py              # Login, logout, password reset
│   ├── client_api.py        # Client API endpoints
│   ├── staff_api.py         # Staff API endpoints
│   ├── idcard_api.py        # ID Card API endpoints
│   ├── settings_api.py      # Settings API endpoints
│   └── examples/            # Refactored examples
│       ├── client_api_refactored.py
│       └── idcard_api_refactored.py
└── utils/                    # Utilities (unchanged)
    ├── email_utils.py
    └── ...
```

## Architecture Principles

### 1. Service Layer Pattern

**Services** contain reusable business logic. They:
- Don't know about HTTP requests/responses
- Return `ServiceResult` objects
- Can be used from views, management commands, or tests
- Handle validation, database operations, and business rules

**Views** are thin HTTP handlers. They:
- Parse request data (JSON, form data, files)
- Call appropriate service methods
- Convert `ServiceResult` to `JsonResponse`
- Handle HTTP-specific concerns (status codes, headers)

### 2. ServiceResult Object

All services return a `ServiceResult`:

```python
@dataclass
class ServiceResult:
    success: bool
    message: str = ''
    data: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    
    def to_response_dict(self) -> dict:
        """Convert to dict for JsonResponse"""
```

Usage:
```python
# In service
def create_client(data):
    if not data.get('email'):
        return ServiceResult(success=False, message='Email required')
    # ... create client ...
    return ServiceResult(success=True, data={'client': {...}}, message='Created!')

# In view
result = ClientService.create(data)
return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
```

### 3. Permission Service

Centralized permission checking:

```python
from core.services import PermissionService

# Check specific permission
if PermissionService.has_permission(user, 'perm_idcard_add'):
    ...

# Use decorators
@require_permission('perm_idcard_add')
def add_idcard_view(request):
    ...

# Get all permissions for template
context = PermissionService.get_permission_context(user)
```

## Service Modules

### ImageService
- `generate_filename(batch_counter, ext)` - New image filename (13 digits)
- `generate_updated_filename(existing_path, ext)` - Update filename (20 digits)
- `validate_image_bytes(bytes)` - Validate image data
- `get_client_image_folder(client)` - Get/create client folder
- `save_image(file, client, existing_path)` - Save image
- `delete_image(path)` - Delete image

### ClientService
- `create(data, request, photo)` - Create client + user
- `get(client_id)` - Get client details
- `update(client_id, data, photo)` - Update client
- `delete(client_id)` - Delete client + user
- `toggle_status(client_id)` - Toggle active/inactive
- `list_all(include_inactive)` - List all clients
- `get_staff(client_id)` - Get client's staff

### StaffService
- `create(data, staff_type, client, request, profile_image)` - Create staff
- `get(staff_id)` - Get staff details
- `update(staff_id, data, profile_image)` - Update staff
- `delete(staff_id)` - Delete staff + user
- `toggle_status(staff_id)` - Toggle active/inactive
- `list_admin_staff()` - List admin staff
- `list_client_staff(client_id)` - List client's staff

### IDCardService
- `create_table(group_id, data)` - Create ID Card Table
- `get_table(table_id)` - Get table details
- `update_table(table_id, data)` - Update table
- `delete_table(table_id)` - Delete table
- `toggle_table_status(table_id)` - Toggle table status
- `list_tables(group_id)` - List group's tables
- `list_cards(table_id, status, offset, limit)` - List cards with pagination
- `get_all_card_ids(table_id, status)` - Get IDs for select all
- `create_card(table_id, field_data, images)` - Create card
- `get_card(card_id)` - Get card details
- `update_card(card_id, field_data, status, images)` - Update card
- `delete_card(card_id)` - Delete card
- `change_status(card_id, status)` - Change card status
- `bulk_change_status(table_id, card_ids, status)` - Bulk status change
- `bulk_delete(table_id, card_ids, delete_all)` - Bulk delete
- `search_cards(table_id, query)` - Search cards
- `get_status_counts(table)` - Get status counts

### ExportService
- `export_xlsx(table_id, card_ids)` - Export as Excel
- `export_images_zip(table_id, card_ids)` - Export images as ZIP

### ImportService
- `bulk_upload(table_id, data_file, zip_files, zip_field_names)` - Bulk import
- `reupload_images(table_id, zip_file, card_ids)` - Reupload images

## Migration Strategy

### Phase 1: Create Services (Done)
Create service files without changing existing views.

### Phase 2: Refactor Views Gradually
Replace one endpoint at a time:

```python
# Before
@api_super_admin_required
def api_client_create(request):
    # 80 lines of logic...

# After
@require_super_admin
def api_client_create(request):
    data = json.loads(request.body)
    result = ClientService.create(data, request=request)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
```

### Phase 3: Add Role-Based Logic
Use PermissionService for multi-role support:

```python
@csrf_exempt
def api_idcard_list(request, table_id):
    user = request.user
    
    # Permission check
    status = request.GET.get('status')
    if status and not PermissionService.can_view_status(user, status):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    
    # Ownership check for clients
    if PermissionService.is_client(user):
        table = get_object_or_404(IDCardTable, id=table_id)
        if table.group.client != user.client_profile:
            return JsonResponse({'success': False, 'message': 'Not your data'}, status=403)
    
    result = IDCardService.list_cards(table_id, status)
    return JsonResponse(result.to_response_dict())
```

## Anti-Patterns to Avoid

### ❌ Fat Services
Don't put HTTP logic in services:
```python
# BAD
def create_client(request):  # Services shouldn't know about request
    data = json.loads(request.body)
```

### ❌ Thin Services
Don't just wrap models:
```python
# BAD - This is useless
def get_client(id):
    return Client.objects.get(id=id)
```

### ❌ Business Logic in Views
```python
# BAD
def api_client_create(request):
    # 50 lines of validation...
    # 30 lines of user creation...
    # This should be in service
```

### ❌ Circular Imports
Services should not import views. Views import services.

### ❌ Over-Abstraction
Don't create services for trivial operations:
```python
# BAD - Too simple, just use model directly
class SettingsService:
    def get_site_name(self):
        return SystemSettings.objects.first().site_name
```

## Testing

Services are easy to test because they don't depend on HTTP:

```python
from django.test import TestCase
from core.services import ClientService

class ClientServiceTest(TestCase):
    def test_create_client_requires_email(self):
        result = ClientService.create({})
        self.assertFalse(result.success)
        self.assertEqual(result.message, 'Email is required')
    
    def test_create_client_success(self):
        result = ClientService.create({
            'email': 'test@example.com',
            'name': 'Test Client',
            'phone': '1234567890'
        })
        self.assertTrue(result.success)
        self.assertIn('client', result.data)
```

## Benefits

1. **Reusability**: Same logic for admin, staff, and client roles
2. **Testability**: Test business logic without HTTP
3. **Readability**: Views are ~20 lines, services are focused
4. **Maintainability**: Change logic in one place
5. **Separation**: HTTP concerns vs business rules
