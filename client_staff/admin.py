from django.contrib import admin
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType

# Register Permission model for admin visibility
# This allows admins to see and manage permissions directly


class PermissionAdmin(admin.ModelAdmin):
    """
    Admin interface for Django Permissions.
    Allows viewing and managing permissions.
    """
    list_display = ('codename', 'name', 'content_type')
    list_filter = ('content_type',)
    search_fields = ('codename', 'name')
    ordering = ('content_type', 'codename')


# Only register if not already registered
try:
    admin.site.unregister(Permission)
except admin.sites.NotRegistered:
    pass

admin.site.register(Permission, PermissionAdmin)
