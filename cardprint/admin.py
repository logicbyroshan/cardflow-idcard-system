from django.contrib import admin

from .models import PrintRequest


@admin.register(PrintRequest)
class PrintRequestAdmin(admin.ModelAdmin):
    list_display = ('id', 'card', 'table', 'status', 'requested_by', 'created_at', 'updated_at')
    list_filter = ('status', 'table')
    search_fields = ('card__field_data', 'card__id')
    raw_id_fields = ('card', 'table', 'requested_by')
    readonly_fields = ('created_at', 'updated_at')
