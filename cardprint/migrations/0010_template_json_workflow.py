from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('cardprint', '0009_cardtemplatedoc'),
    ]

    operations = [
        migrations.AddField(
            model_name='cardtemplate',
            name='name',
            field=models.CharField(default='Default Template', max_length=120),
        ),
        migrations.AddField(
            model_name='cardtemplate',
            name='template_json',
            field=models.JSONField(
                blank=True,
                default={
                    'canvas': {'width': 350, 'height': 200},
                    'elements': [],
                },
                help_text='Template-driven canvas data for field elements rendering.',
            ),
        ),
        migrations.AlterField(
            model_name='cardtemplate',
            name='table',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='card_templates',
                to='core.idcardtable',
            ),
        ),
    ]
