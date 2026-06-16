from django.db import migrations

class Migration(migrations.Migration):

    dependencies = [
        ('core', '0084_remove_client_logo_client_icon_and_more'),
    ]

    operations = [
        migrations.RunSQL(
            """
            DROP TABLE IF EXISTS core_officeworkchatgroupmember CASCADE;
            DROP TABLE IF EXISTS core_officeworkchatgroup CASCADE;
            DROP TABLE IF EXISTS core_officeworkchatmessage CASCADE;
            DROP TABLE IF EXISTS core_officeworktaskcomment CASCADE;
            DROP TABLE IF EXISTS core_officeworktask CASCADE;
            DROP TABLE IF EXISTS core_officeworksharedfile CASCADE;
            DROP TABLE IF EXISTS core_officeworklead CASCADE;
            """,
            reverse_sql=""
        )
    ]
