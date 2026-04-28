from django.contrib import admin

from .models import (
    OfficeWorkChatGroup,
    OfficeWorkChatGroupMember,
    OfficeWorkChatMessage,
    OfficeWorkTask,
)

try:
    from .models import OfficeWorkSharedFile
except ImportError:
    OfficeWorkSharedFile = None


class OfficeWorkChatGroupMemberInline(admin.TabularInline):
    model = OfficeWorkChatGroupMember
    extra = 0
    autocomplete_fields = ('user', 'added_by')


@admin.register(OfficeWorkChatGroup)
class OfficeWorkChatGroupAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'is_active', 'created_by', 'created_at', 'updated_at')
    list_filter = ('is_active', 'created_at')
    search_fields = ('name', 'created_by__username', 'created_by__email')
    readonly_fields = ('created_at', 'updated_at')
    inlines = (OfficeWorkChatGroupMemberInline,)


@admin.register(OfficeWorkChatGroupMember)
class OfficeWorkChatGroupMemberAdmin(admin.ModelAdmin):
    list_display = ('id', 'group', 'user', 'added_by', 'created_at')
    list_filter = ('group', 'created_at')
    search_fields = ('group__name', 'user__username', 'user__email')
    readonly_fields = ('created_at',)
    autocomplete_fields = ('group', 'user', 'added_by')


@admin.register(OfficeWorkChatMessage)
class OfficeWorkChatMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'group', 'sender', 'attachment_original_name', 'attachment_size_bytes', 'created_at')
    search_fields = ('message', 'sender__username', 'sender__email')
    list_filter = ('group', 'created_at')
    readonly_fields = ('created_at',)


@admin.register(OfficeWorkTask)
class OfficeWorkTaskAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'status', 'priority', 'assigned_to', 'created_at', 'updated_at')
    list_filter = ('status', 'priority', 'created_at', 'updated_at')
    search_fields = ('title', 'description', 'assigned_to__username', 'created_by__username')
    readonly_fields = ('created_at', 'updated_at', 'completed_at')


if OfficeWorkSharedFile is not None:
    @admin.register(OfficeWorkSharedFile)
    class OfficeWorkSharedFileAdmin(admin.ModelAdmin):
        list_display = ('id', 'title', 'original_name', 'uploaded_by', 'size_bytes', 'created_at')
        search_fields = ('title', 'original_name', 'uploaded_by__username', 'uploaded_by__email')
        list_filter = ('created_at',)
        readonly_fields = ('created_at',)
