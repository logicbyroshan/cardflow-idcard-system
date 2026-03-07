from django.contrib import admin
from .models import Message


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = (
        'subject', 'from_email', 'to_email', 'direction', 'status',
        'sender', 'recipient', 'is_read', 'created_at',
    )
    list_filter = ('direction', 'status', 'is_read', 'created_at')
    search_fields = (
        'subject', 'body', 'from_email', 'to_email',
        'sender__username', 'recipient__username',
    )
    raw_id_fields = ('sender', 'recipient')
    readonly_fields = ('uuid',)
