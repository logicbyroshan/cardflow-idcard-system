from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('website', '0017_update_bento_layout_v2'),
    ]

    operations = [
        migrations.DeleteModel(
            name='TrustedClient',
        ),
    ]
