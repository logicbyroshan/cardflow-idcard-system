from django.contrib import admin

from .models import OfficeWorkChatMessage, OfficeWorkSharedFile, OfficeWorkTask


@admin.register(OfficeWorkChatMessage)
class OfficeWorkChatMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'sender', 'created_at')
    search_fields = ('message', 'sender__username', 'sender__email')
    list_filter = ('created_at',)
    readonly_fields = ('created_at',)


@admin.register(OfficeWorkTask)
class OfficeWorkTaskAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'status', 'priority', 'assigned_to', 'created_at', 'updated_at')
    list_filter = ('status', 'priority', 'created_at', 'updated_at')
    search_fields = ('title', 'description', 'assigned_to__username', 'created_by__username')
    readonly_fields = ('created_at', 'updated_at', 'completed_at')


@admin.register(OfficeWorkSharedFile)
class OfficeWorkSharedFileAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'original_name', 'uploaded_by', 'size_bytes', 'created_at')
    search_fields = ('title', 'original_name', 'uploaded_by__username', 'uploaded_by__email')
    list_filter = ('created_at',)
    readonly_fields = ('created_at',)
