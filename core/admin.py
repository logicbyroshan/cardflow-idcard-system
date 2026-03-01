from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.models import Permission
from client.models import Client
from staff.models import Staff
from idcards.models import IDCardGroup, IDCard, IDCardTable
from .models import User, SystemSettings, ExportTemplate, ActivityLog, Notification, NotificationRead, CropperRelease


# Register Permission model for admin visibility (moved from deprecated client_staff app)
class PermissionAdmin(admin.ModelAdmin):
    """Admin interface for Django Permissions."""
    list_display = ('codename', 'name', 'content_type')
    list_filter = ('content_type',)
    search_fields = ('codename', 'name')
    ordering = ('content_type', 'codename')

try:
    admin.site.unregister(Permission)
except admin.sites.NotRegistered:
    pass
admin.site.register(Permission, PermissionAdmin)


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    """Admin configuration for User model"""
    list_display = ('username', 'email', 'first_name', 'last_name', 'role', 'is_active')
    list_filter = ('role', 'is_active', 'is_staff')
    search_fields = ('username', 'email', 'first_name', 'last_name')
    fieldsets = UserAdmin.fieldsets + (
        ('Additional Info', {'fields': ('phone', 'role')}),
    )


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'city', 'status', 'created_at')
    list_filter = ('status', 'city', 'state')
    search_fields = ('name', 'user__username', 'user__email')
    raw_id_fields = ('user',)


@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ('user', 'staff_type', 'client', 'department', 'designation')
    list_filter = ('staff_type', 'department')
    search_fields = ('user__username', 'user__first_name', 'user__last_name')
    raw_id_fields = ('user', 'client')


@admin.register(IDCardGroup)
class IDCardGroupAdmin(admin.ModelAdmin):
    list_display = ('name', 'client', 'is_active', 'created_at')
    list_filter = ('is_active', 'client')
    search_fields = ('name', 'client__name')
    list_select_related = ('client',)


@admin.register(IDCardTable)
class IDCardTableAdmin(admin.ModelAdmin):
    list_display = ('name', 'group', 'is_active', 'created_at')
    list_filter = ('is_active', 'group__client')
    search_fields = ('name', 'group__name')


@admin.register(IDCard)
class IDCardAdmin(admin.ModelAdmin):
    list_display = ('id', 'table', 'status', 'created_at')
    list_filter = ('status', 'table__group__client')
    search_fields = ('field_data',)
    raw_id_fields = ('table',)
    list_select_related = ('table',)


@admin.register(SystemSettings)
class SystemSettingsAdmin(admin.ModelAdmin):
    list_display = ('key', 'value', 'updated_at')
    search_fields = ('key', 'description')


@admin.register(ExportTemplate)
class ExportTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_default', 'updated_at')
    search_fields = ('name',)
    list_editable = ('is_default',)


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ('user', 'action', 'description', 'target_model', 'created_at')
    list_filter = ('action', 'target_model', 'created_at')
    search_fields = ('description', 'target_name', 'user__username')
    readonly_fields = ('user', 'action', 'description', 'target_model', 'target_id',
                       'target_name', 'ip_address', 'created_at')
    date_hierarchy = 'created_at'

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('title', 'priority', 'category', 'target', 'created_by', 'is_active', 'created_at')
    list_filter = ('priority', 'category', 'target', 'is_active', 'created_at')
    search_fields = ('title', 'message')
    raw_id_fields = ('created_by',)
    filter_horizontal = ('target_users',)
    readonly_fields = ('created_at',)
    date_hierarchy = 'created_at'


@admin.register(NotificationRead)
class NotificationReadAdmin(admin.ModelAdmin):
    list_display = ('user', 'notification', 'read_at')
    list_filter = ('read_at',)
    raw_id_fields = ('user', 'notification')
    readonly_fields = ('read_at',)


@admin.register(CropperRelease)
class CropperReleaseAdmin(admin.ModelAdmin):
    list_display = ('version', 'is_latest', 'download_url', 'released_at')
    list_filter = ('is_latest',)
    search_fields = ('version', 'changelog')
    readonly_fields = ('released_at',)
    list_editable = ('is_latest',)
