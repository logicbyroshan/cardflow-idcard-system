from django.db import migrations, models
import django.db.models.deletion
from django.db.models import Q


class Migration(migrations.Migration):

    # PostgreSQL can raise "cannot ALTER TABLE ... because it has pending
    # trigger events" when this migration updates rows and then adds
    # constraints on the same table within one transaction.
    atomic = False

    dependencies = [
        ('cardprint', '0012_alter_cardtemplate_template_json'),
    ]

    operations = [
        migrations.AddField(
            model_name='cardtemplate',
            name='version',
            field=models.PositiveIntegerField(db_index=True, default=1),
        ),
        migrations.AddField(
            model_name='cardtemplate',
            name='is_active',
            field=models.BooleanField(db_index=True, default=True),
        ),
        migrations.AddField(
            model_name='cardtemplate',
            name='is_default',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='cardtemplate',
            name='parent_template',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='child_versions', to='cardprint.cardtemplate'),
        ),
        migrations.AddField(
            model_name='cardtemplate',
            name='usage_count',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='cardtemplate',
            name='last_used_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunSQL(
            sql=(
                "WITH ranked AS ("
                " SELECT id, table_id, ROW_NUMBER() OVER (PARTITION BY table_id ORDER BY created_at ASC, id ASC) AS rn"
                " FROM cardprint_cardtemplate"
                ")"
                " UPDATE cardprint_cardtemplate"
                " SET version = (SELECT ranked.rn FROM ranked WHERE ranked.id = cardprint_cardtemplate.id)"
                " WHERE id IN (SELECT id FROM ranked)"
            ),
            reverse_sql=(
                "UPDATE cardprint_cardtemplate "
                "SET version = 1, is_active = TRUE"
            ),
        ),
        migrations.RunSQL(
            sql=(
                "WITH default_pick AS ("
                " SELECT id, table_id FROM ("
                "   SELECT id, table_id, ROW_NUMBER() OVER (PARTITION BY table_id ORDER BY is_active DESC, version DESC, id DESC) AS rn"
                "   FROM cardprint_cardtemplate"
                " ) ranked_defaults WHERE rn = 1"
                ")"
                " UPDATE cardprint_cardtemplate"
                " SET is_default = CASE"
                "   WHEN id = (SELECT default_pick.id FROM default_pick WHERE default_pick.table_id = cardprint_cardtemplate.table_id)"
                "   THEN TRUE ELSE FALSE END"
                " WHERE table_id IN (SELECT table_id FROM default_pick)"
            ),
            reverse_sql=(
                "UPDATE cardprint_cardtemplate SET is_default = FALSE"
            ),
        ),
        migrations.AddConstraint(
            model_name='cardtemplate',
            constraint=models.UniqueConstraint(fields=('table', 'version'), name='uniq_template_version_per_table'),
        ),
        migrations.AddConstraint(
            model_name='cardtemplate',
            constraint=models.UniqueConstraint(condition=Q(is_default=True), fields=('table',), name='uniq_default_template_per_table'),
        ),
    ]
