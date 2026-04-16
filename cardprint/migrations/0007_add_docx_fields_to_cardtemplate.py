from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cardprint', '0006_remove_print_list_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='cardtemplate',
            name='front_docx',
            field=models.FileField(blank=True, help_text='Front-side DOCX template', null=True, upload_to='card_templates/docx/front/'),
        ),
        migrations.AddField(
            model_name='cardtemplate',
            name='back_docx',
            field=models.FileField(blank=True, help_text='Back-side DOCX template', null=True, upload_to='card_templates/docx/back/'),
        ),
    ]
