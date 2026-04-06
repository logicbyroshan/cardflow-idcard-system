from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('cardprint', '0008_remove_docx_fields_from_cardtemplate'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CardTemplateDoc',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('layout_id', models.CharField(db_index=True, max_length=40)),
                ('name', models.CharField(max_length=80)),
                ('docx_file', models.FileField(blank=True, null=True, upload_to='card_templates/docs/')),
                ('snapshot', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='card_template_docs', to=settings.AUTH_USER_MODEL)),
                ('template', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='saved_docs', to='cardprint.cardtemplate')),
            ],
            options={
                'ordering': ['-updated_at', '-created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='cardtemplatedoc',
            constraint=models.UniqueConstraint(fields=('template', 'layout_id'), name='uniq_cardtemplate_layout_id'),
        ),
        migrations.AddIndex(
            model_name='cardtemplatedoc',
            index=models.Index(fields=['template', '-updated_at'], name='cardprint_c_templat_e413cc_idx'),
        ),
    ]
