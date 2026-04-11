from django.contrib import admin
from .models import MobileDevice


@admin.register(MobileDevice)
class MobileDeviceAdmin(admin.ModelAdmin):
	list_display = (
		'id',
		'user',
		'platform',
		'installation_id',
		'app_version',
		'app_build',
		'is_active',
		'last_seen_at',
	)
	search_fields = ('installation_id', 'push_token', 'user__username', 'user__email')
	list_filter = ('platform', 'is_active')
	readonly_fields = ('created_at', 'updated_at', 'last_seen_at')
