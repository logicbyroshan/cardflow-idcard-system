"""
Migration: Add generate_list status + CardTemplate model.
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cardprint', '0003_remove_downloaded_status'),
        ('core', '0044_add_font_fields_to_exporttemplate'),
    ]

    operations = [
        # 1. Add 'generate_list' to PrintRequest.status choices
        migrations.AlterField(
            model_name='printrequest',
            name='status',
            field=models.CharField(
                choices=[
                    ('print_list', 'Print List'),
                    ('generate_list', 'Generate List'),
                    ('finalized', 'Finalized'),
                    ('pool', 'Pool'),
                ],
                db_index=True,
                default='print_list',
                max_length=20,
            ),
        ),
        # 2. Create CardTemplate model
        migrations.CreateModel(
            name='CardTemplate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('front_pdf', models.FileField(blank=True, help_text='Front-side PDF template (87mm × 57mm)', null=True, upload_to='card_templates/front/')),
                ('back_pdf', models.FileField(blank=True, help_text='Back-side PDF template (87mm × 57mm)', null=True, upload_to='card_templates/back/')),
                ('is_two_sided', models.BooleanField(default=False)),
                ('field_mappings', models.JSONField(default=dict, help_text='Coordinate mappings per side: {"front": {field: {x_mm, y_mm, w_mm, h_mm}}}')),
                ('font_size', models.IntegerField(default=8, help_text='Font size in points (7–10)')),
                ('font_family', models.CharField(
                    choices=[('Helvetica-Bold', 'Arial Bold'), ('Helvetica', 'Arial Regular')],
                    default='Helvetica-Bold',
                    max_length=50,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('table', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='card_template',
                    to='core.idcardtable',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
