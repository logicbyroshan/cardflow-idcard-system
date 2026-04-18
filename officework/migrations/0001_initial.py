# Generated manually to move Office Work models from core app state

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import officework.models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('core', '0069_officeworkchatmessage_officeworksharedfile_and_more'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.CreateModel(
                    name='OfficeWorkChatMessage',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('message', models.TextField()),
                        ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                        ('sender', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='office_work_chat_messages', to=settings.AUTH_USER_MODEL)),
                    ],
                    options={
                        'verbose_name': 'Office Work Chat Message',
                        'verbose_name_plural': 'Office Work Chat Messages',
                        'db_table': 'core_officeworkchatmessage',
                        'ordering': ['-id'],
                        'indexes': [models.Index(fields=['-created_at'], name='owchat_created_idx')],
                    },
                ),
                migrations.CreateModel(
                    name='OfficeWorkSharedFile',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('title', models.CharField(blank=True, default='', max_length=200)),
                        ('note', models.TextField(blank=True, default='')),
                        ('original_name', models.CharField(blank=True, default='', max_length=255)),
                        ('file', models.FileField(upload_to=officework.models.office_work_shared_file_upload_to)),
                        ('size_bytes', models.BigIntegerField(default=0)),
                        ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                        ('uploaded_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='office_work_shared_files', to=settings.AUTH_USER_MODEL)),
                    ],
                    options={
                        'verbose_name': 'Office Work Shared File',
                        'verbose_name_plural': 'Office Work Shared Files',
                        'db_table': 'core_officeworksharedfile',
                        'ordering': ['-created_at'],
                        'indexes': [models.Index(fields=['-created_at'], name='owfile_created_idx')],
                    },
                ),
                migrations.CreateModel(
                    name='OfficeWorkTask',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('title', models.CharField(max_length=180)),
                        ('description', models.TextField(blank=True, default='')),
                        ('status', models.CharField(choices=[('todo', 'Todo'), ('in_progress', 'In Progress'), ('done', 'Done')], db_index=True, default='todo', max_length=20)),
                        ('priority', models.CharField(choices=[('low', 'Low'), ('normal', 'Normal'), ('high', 'High')], db_index=True, default='normal', max_length=20)),
                        ('due_date', models.DateField(blank=True, db_index=True, null=True)),
                        ('completed_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                        ('assigned_to', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='office_work_tasks_assigned', to=settings.AUTH_USER_MODEL)),
                        ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='office_work_tasks_created', to=settings.AUTH_USER_MODEL)),
                    ],
                    options={
                        'verbose_name': 'Office Work Task',
                        'verbose_name_plural': 'Office Work Tasks',
                        'db_table': 'core_officeworktask',
                        'ordering': ['-updated_at', '-id'],
                        'indexes': [
                            models.Index(fields=['status', '-updated_at'], name='owtask_status_updated_idx'),
                            models.Index(fields=['assigned_to', 'status'], name='owtask_assigned_status_idx'),
                        ],
                    },
                ),
            ],
        ),
    ]
