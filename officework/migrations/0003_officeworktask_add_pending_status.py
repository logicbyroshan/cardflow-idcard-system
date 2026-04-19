from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('officework', '0002_officeworkchatgroupmember_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='officeworktask',
            name='status',
            field=models.CharField(
                choices=[
                    ('todo', 'Todo'),
                    ('in_progress', 'In Progress'),
                    ('done', 'Done'),
                    ('pending', 'Pending'),
                ],
                db_index=True,
                default='todo',
                max_length=20,
            ),
        ),
    ]
