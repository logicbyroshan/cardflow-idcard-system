from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, Client, Staff, IDCardGroup, IDCard, IDCardTable, WebsiteSettings, SystemSettings, ActivityLog


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    """Admin configuration for User model"""
    list_display = ('username', 'email', 'first_name', 'last_name', 'role', 'is_active')
    list_filter = ('role', 'is_active', 'is_staff')
    search_fields = ('username', 'email', 'first_name', 'last_name')
    fieldsets = UserAdmin.fieldsets + (
        ('Additional Info', {'fields': ('phone', 'role', 'profile_image')}),
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


@admin.register(WebsiteSettings)
class WebsiteSettingsAdmin(admin.ModelAdmin):
    list_display = ('site_name', 'contact_email', 'contact_phone')


@admin.register(SystemSettings)
class SystemSettingsAdmin(admin.ModelAdmin):
    list_display = ('key', 'value', 'updated_at')
    search_fields = ('key', 'description')


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
