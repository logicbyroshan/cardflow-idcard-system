from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='MobileDevice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('platform', models.CharField(default='android', max_length=20)),
                ('installation_id', models.CharField(max_length=80)),
                ('push_token', models.CharField(blank=True, max_length=255)),
                ('app_version', models.CharField(blank=True, max_length=32)),
                ('app_build', models.PositiveIntegerField(default=0)),
                ('device_model', models.CharField(blank=True, max_length=120)),
                ('os_version', models.CharField(blank=True, max_length=50)),
                ('device_language', models.CharField(blank=True, max_length=32)),
                ('last_ip', models.GenericIPAddressField(blank=True, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('last_seen_at', models.DateTimeField(auto_now=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='mobile_devices', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-last_seen_at'],
            },
        ),
        migrations.AddIndex(
            model_name='mobiledevice',
            index=models.Index(fields=['platform', 'installation_id'], name='mobile_app_m_platfor_d4a050_idx'),
        ),
        migrations.AddIndex(
            model_name='mobiledevice',
            index=models.Index(fields=['user', 'is_active'], name='mobile_app_m_user_id_c59c27_idx'),
        ),
        migrations.AddIndex(
            model_name='mobiledevice',
            index=models.Index(fields=['user', '-last_seen_at'], name='mobile_app_m_user_id_b57c9a_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='mobiledevice',
            unique_together={('user', 'platform', 'installation_id')},
        ),
    ]
