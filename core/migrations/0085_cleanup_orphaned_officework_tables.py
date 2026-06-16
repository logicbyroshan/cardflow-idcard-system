from django.db import migrations

class Migration(migrations.Migration):

    dependencies = [
        ('core', '0084_remove_client_logo_client_icon_and_more'),
    ]

    operations = [
        migrations.RunSQL(
            """
            DROP TABLE IF EXISTS core_officeworkchatgroupmember;
            DROP TABLE IF EXISTS core_officeworkchatgroup;
            DROP TABLE IF EXISTS core_officeworkchatmessage;
            DROP TABLE IF EXISTS core_officeworktaskcomment;
            DROP TABLE IF EXISTS core_officeworktask;
            DROP TABLE IF EXISTS core_officeworksharedfile;
            DROP TABLE IF EXISTS core_officeworklead;
            """,
            reverse_sql=""
        )
    ]
