from django.conf import settings
from django.db import models


class MobileDevice(models.Model):
	"""Tracks Android app-shell device metadata per authenticated user."""

	user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='mobile_devices')
	platform = models.CharField(max_length=20, default='android')
	installation_id = models.CharField(max_length=80)
	push_token = models.CharField(max_length=255, blank=True)
	app_version = models.CharField(max_length=32, blank=True)
	app_build = models.PositiveIntegerField(default=0)
	device_model = models.CharField(max_length=120, blank=True)
	os_version = models.CharField(max_length=50, blank=True)
	device_language = models.CharField(max_length=32, blank=True)
	last_ip = models.GenericIPAddressField(null=True, blank=True)
	is_active = models.BooleanField(default=True)
	last_seen_at = models.DateTimeField(auto_now=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		unique_together = ('user', 'platform', 'installation_id')
		indexes = [
			models.Index(fields=['platform', 'installation_id']),
			models.Index(fields=['user', 'is_active']),
			models.Index(fields=['user', '-last_seen_at']),
		]
		ordering = ['-last_seen_at']

	def __str__(self):
		user_repr = getattr(self.user, 'username', None) or getattr(self.user, 'email', None) or f'user:{self.user_id}'
		return f'{self.platform}:{self.installation_id} ({user_repr})'
