from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('cardprint', '0007_add_docx_fields_to_cardtemplate'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='cardtemplate',
            name='back_docx',
        ),
        migrations.RemoveField(
            model_name='cardtemplate',
            name='front_docx',
        ),
    ]
