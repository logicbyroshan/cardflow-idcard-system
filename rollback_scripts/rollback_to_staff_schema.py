#!/usr/bin/env python
"""
rollback_to_staff_schema.py
===========================
Run this on the server BEFORE switching git branch to old main.

Usage (inside current codebase shell):
    python manage.py shell < rollback_scripts/rollback_to_staff_schema.py

What this does:
  1. Creates old core_staff table + M2M tables
  2. Copies operators_operator -> core_staff (staff_type=admin_staff)
  3. Copies assistants_assistant -> core_staff (staff_type=client_staff)
  4. Creates admin_staff record for photographer users (photographers had no model in old schema)
  5. Updates User.role: operator->admin_staff, assistant->client_staff, photographer->admin_staff
  6. Prints verification counts

IMPORTANT: Run this while the NEW codebase is still active (before git checkout).
"""

import sys
import logging
from django.db import connection, transaction
from django.utils import timezone

logger = logging.getLogger('rollback')
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')


def check_tables():
    with connection.cursor() as c:
        c.execute("""SELECT table_name FROM information_schema.tables WHERE table_schema='public'
                     AND table_name IN ('operators_operator','assistants_assistant','core_staff')""")
        tables = {r[0] for r in c.fetchall()}
    logger.info("Found tables: %s", tables)
    if 'core_staff' in tables:
        with connection.cursor() as c:
            c.execute("SELECT COUNT(*) FROM core_staff")
            n = c.fetchone()[0]
        if n:
            raise RuntimeError(f"core_staff already has {n} rows - aborting to prevent duplicates!")
        logger.info("core_staff exists but empty, will populate.")
    return tables


def create_tables():
    logger.info("Creating core_staff tables...")
    stmts = [
        """CREATE TABLE IF NOT EXISTS core_staff (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL UNIQUE REFERENCES core_user(id) ON DELETE CASCADE,
            staff_type VARCHAR(20) NOT NULL,
            client_id INTEGER REFERENCES core_client(id) ON DELETE CASCADE,
            assigned_table_ids JSONB NOT NULL DEFAULT '[]',
            allowed_classes JSONB NOT NULL DEFAULT '[]',
            allowed_sections JSONB NOT NULL DEFAULT '[]',
            allowed_branches JSONB NOT NULL DEFAULT '[]',
            assignment_scopes JSONB NOT NULL DEFAULT '[]',
            address TEXT,
            department VARCHAR(100),
            designation VARCHAR(100),
            perm_idcard_client_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_manage_client_staff BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_setting_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_setting_add BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_setting_edit BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_setting_delete BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_setting_status BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_pending_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_verified_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_pool_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_approved_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_download_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_reprint_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_reprint_request_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_confirmed_list BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_add BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_edit BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_delete BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_info BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_approve BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_verify BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_updated_at BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_delete_from_pool BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_clear_pending_path BOOLEAN NOT NULL DEFAULT FALSE,
            perm_reupload_idcard_image BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_retrieve BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_bulk_upload BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_bulk_download BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_download_image_rename_mode BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_download_image_generate_mode BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_bulk_reupload BOOLEAN NOT NULL DEFAULT FALSE,
            perm_idcard_upgrade_all BOOLEAN NOT NULL DEFAULT FALSE,
            perm_mobile_app BOOLEAN NOT NULL DEFAULT FALSE,
            perm_manage_panel_backup BOOLEAN NOT NULL DEFAULT FALSE,
            perm_manage_panel_email BOOLEAN NOT NULL DEFAULT FALSE,
            perm_pro_user_options BOOLEAN NOT NULL DEFAULT FALSE,
            perm_pro_log_deletion_guard BOOLEAN NOT NULL DEFAULT FALSE,
            perm_pro_data_deletion_guard BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS core_staff_assigned_clients (
            id BIGSERIAL PRIMARY KEY,
            staff_id BIGINT NOT NULL REFERENCES core_staff(id) ON DELETE CASCADE,
            client_id INTEGER NOT NULL REFERENCES core_client(id) ON DELETE CASCADE,
            UNIQUE(staff_id, client_id)
        )""",
        """CREATE TABLE IF NOT EXISTS core_staff_assigned_groups (
            id BIGSERIAL PRIMARY KEY,
            staff_id BIGINT NOT NULL REFERENCES core_staff(id) ON DELETE CASCADE,
            idcardgroup_id INTEGER NOT NULL REFERENCES core_idcardgroup(id) ON DELETE CASCADE,
            UNIQUE(staff_id, idcardgroup_id)
        )""",
        "CREATE INDEX IF NOT EXISTS staff_type_created_idx ON core_staff (staff_type, created_at)",
        "CREATE INDEX IF NOT EXISTS staff_created_idx ON core_staff (created_at)",
        "CREATE INDEX IF NOT EXISTS staff_client_type_idx ON core_staff (client_id, staff_type)",
    ]
    with connection.cursor() as c:
        for sql in stmts:
            c.execute(sql)
    logger.info("Tables created.")


def migrate_operators():
    with connection.cursor() as c:
        c.execute("SELECT COUNT(*) FROM operators_operator")
        n = c.fetchone()[0]
    if not n:
        logger.info("No operators. Skipping.")
        return
    logger.info("Migrating %d operators -> core_staff (admin_staff)...", n)
    PERM_COLS = ",".join([
        "perm_idcard_client_list","perm_manage_client_staff",
        "perm_idcard_setting_list","perm_idcard_setting_add","perm_idcard_setting_edit",
        "perm_idcard_setting_delete","perm_idcard_setting_status",
        "perm_idcard_pending_list","perm_idcard_verified_list","perm_idcard_pool_list",
        "perm_idcard_approved_list","perm_idcard_download_list","perm_idcard_reprint_list",
        "perm_reprint_request_list","perm_confirmed_list",
        "perm_idcard_add","perm_idcard_edit","perm_idcard_delete","perm_idcard_info",
        "perm_idcard_approve","perm_idcard_verify","perm_idcard_updated_at",
        "perm_idcard_delete_from_pool","perm_idcard_clear_pending_path",
        "perm_reupload_idcard_image","perm_idcard_retrieve",
        "perm_idcard_bulk_upload","perm_idcard_bulk_download",
        "perm_idcard_download_image_rename_mode","perm_idcard_download_image_generate_mode",
        "perm_idcard_bulk_reupload","perm_idcard_upgrade_all",
        "perm_mobile_app","perm_manage_panel_backup","perm_manage_panel_email",
        "perm_pro_user_options","perm_pro_log_deletion_guard","perm_pro_data_deletion_guard",
    ])
    with connection.cursor() as c:
        c.execute(f"""
            INSERT INTO core_staff (
                id, user_id, staff_type, client_id,
                assigned_table_ids, allowed_classes, allowed_sections, allowed_branches, assignment_scopes,
                address, department, designation,
                {PERM_COLS},
                created_at, updated_at
            )
            SELECT
                op.id, op.user_id, 'admin_staff', NULL,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                NULL, op.department, op.designation,
                op.{',op.'.join(PERM_COLS.split(','))},
                op.created_at, op.updated_at
            FROM operators_operator op
        """)
        logger.info("  Inserted %d rows.", c.rowcount)
        c.execute("""
            INSERT INTO core_staff_assigned_clients (staff_id, client_id)
            SELECT operator_id, client_id FROM operators_operator_assigned_clients
            ON CONFLICT DO NOTHING
        """)
        logger.info("  Copied %d client M2M links.", c.rowcount)
        c.execute("SELECT setval('core_staff_id_seq', (SELECT MAX(id) FROM core_staff))")


def migrate_assistants():
    with connection.cursor() as c:
        c.execute("SELECT COUNT(*) FROM assistants_assistant")
        n = c.fetchone()[0]
    if not n:
        logger.info("No assistants. Skipping.")
        return
    logger.info("Migrating %d assistants -> core_staff (client_staff)...", n)
    PERM_COLS = ",".join([
        "perm_idcard_client_list","perm_manage_client_staff",
        "perm_idcard_setting_list","perm_idcard_setting_add","perm_idcard_setting_edit",
        "perm_idcard_setting_delete","perm_idcard_setting_status",
        "perm_idcard_pending_list","perm_idcard_verified_list","perm_idcard_pool_list",
        "perm_idcard_approved_list","perm_idcard_download_list","perm_idcard_reprint_list",
        "perm_reprint_request_list","perm_confirmed_list",
        "perm_idcard_add","perm_idcard_edit","perm_idcard_delete","perm_idcard_info",
        "perm_idcard_approve","perm_idcard_verify","perm_idcard_updated_at",
        "perm_idcard_delete_from_pool","perm_idcard_clear_pending_path",
        "perm_reupload_idcard_image","perm_idcard_retrieve",
        "perm_idcard_bulk_upload","perm_idcard_bulk_download",
        "perm_idcard_download_image_rename_mode","perm_idcard_download_image_generate_mode",
        "perm_idcard_bulk_reupload","perm_idcard_upgrade_all",
        "perm_mobile_app","perm_manage_panel_backup","perm_manage_panel_email",
        "perm_pro_user_options","perm_pro_log_deletion_guard","perm_pro_data_deletion_guard",
    ])
    with connection.cursor() as c:
        c.execute(f"""
            INSERT INTO core_staff (
                id, user_id, staff_type, client_id,
                assigned_table_ids, allowed_classes, allowed_sections, allowed_branches, assignment_scopes,
                address, department, designation,
                {PERM_COLS},
                created_at, updated_at
            )
            SELECT
                ast.id, ast.user_id, 'client_staff', ast.client_id,
                COALESCE(ast.assigned_table_ids,'[]'::jsonb),
                COALESCE(ast.allowed_classes,'[]'::jsonb),
                COALESCE(ast.allowed_sections,'[]'::jsonb),
                COALESCE(ast.allowed_branches,'[]'::jsonb),
                COALESCE(ast.assignment_scopes,'[]'::jsonb),
                NULL, ast.department, ast.designation,
                ast.{',ast.'.join(PERM_COLS.split(','))},
                ast.created_at, ast.updated_at
            FROM assistants_assistant ast
        """)
        logger.info("  Inserted %d rows.", c.rowcount)
        c.execute("""
            INSERT INTO core_staff_assigned_groups (staff_id, idcardgroup_id)
            SELECT assistant_id, idcardgroup_id FROM assistants_assistant_assigned_groups
            ON CONFLICT DO NOTHING
        """)
        logger.info("  Copied %d group M2M links.", c.rowcount)
        c.execute("SELECT setval('core_staff_id_seq', (SELECT MAX(id) FROM core_staff))")


def migrate_photographers():
    now = timezone.now()
    with connection.cursor() as c:
        c.execute("""
            SELECT id, username FROM core_user
            WHERE role='photographer'
            AND NOT EXISTS (SELECT 1 FROM core_staff WHERE user_id=core_user.id)
        """)
        photographers = c.fetchall()
    if not photographers:
        logger.info("No unmatched photographers. Skipping.")
        return
    logger.info("Creating admin_staff records for %d photographer users...", len(photographers))
    with connection.cursor() as c:
        for uid, uname in photographers:
            c.execute("""
                INSERT INTO core_staff (user_id, staff_type, client_id,
                    assigned_table_ids, allowed_classes, allowed_sections, allowed_branches, assignment_scopes,
                    address, department, designation,
                    perm_idcard_client_list, perm_manage_client_staff,
                    perm_idcard_setting_list, perm_idcard_setting_add, perm_idcard_setting_edit,
                    perm_idcard_setting_delete, perm_idcard_setting_status,
                    perm_idcard_pending_list, perm_idcard_verified_list, perm_idcard_pool_list,
                    perm_idcard_approved_list, perm_idcard_download_list, perm_idcard_reprint_list,
                    perm_reprint_request_list, perm_confirmed_list,
                    perm_idcard_add, perm_idcard_edit, perm_idcard_delete, perm_idcard_info,
                    perm_idcard_approve, perm_idcard_verify, perm_idcard_updated_at,
                    perm_idcard_delete_from_pool, perm_idcard_clear_pending_path,
                    perm_reupload_idcard_image, perm_idcard_retrieve,
                    perm_idcard_bulk_upload, perm_idcard_bulk_download,
                    perm_idcard_download_image_rename_mode, perm_idcard_download_image_generate_mode,
                    perm_idcard_bulk_reupload, perm_idcard_upgrade_all,
                    perm_mobile_app, perm_manage_panel_backup, perm_manage_panel_email,
                    perm_pro_user_options, perm_pro_log_deletion_guard, perm_pro_data_deletion_guard,
                    created_at, updated_at)
                VALUES (%s,'admin_staff',NULL,'[]','[]','[]','[]','[]',NULL,'Photography','Photographer',
                    FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,
                    FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,
                    FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,
                    FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,
                    FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,%s,%s)
            """, [uid, now, now])
            logger.info("  Created admin_staff for %s", uname)
        c.execute("SELECT setval('core_staff_id_seq', (SELECT MAX(id) FROM core_staff))")


def update_user_roles():
    logger.info("Updating User.role values...")
    with connection.cursor() as c:
        c.execute("UPDATE core_user SET role='admin_staff' WHERE role='operator'")
        logger.info("  operator->admin_staff: %d", c.rowcount)
        c.execute("UPDATE core_user SET role='client_staff' WHERE role='assistant'")
        logger.info("  assistant->client_staff: %d", c.rowcount)
        c.execute("UPDATE core_user SET role='admin_staff' WHERE role='photographer'")
        logger.info("  photographer->admin_staff: %d", c.rowcount)


def verify():
    logger.info("=== VERIFICATION ===")
    with connection.cursor() as c:
        c.execute("SELECT staff_type, COUNT(*) FROM core_staff GROUP BY staff_type")
        for row in c.fetchall():
            logger.info("  core_staff[%s] = %d rows", row[0], row[1])
        c.execute("SELECT role, COUNT(*) FROM core_user WHERE role IN ('admin_staff','client_staff','operator','assistant','photographer') GROUP BY role")
        bad = []
        for row in c.fetchall():
            logger.info("  User.role[%s] = %d", row[0], row[1])
            if row[0] in ('operator','assistant','photographer'):
                bad.append(row)
    if bad:
        logger.warning("WARNING: Some users still have new roles: %s", bad)
    else:
        logger.info("All roles correctly migrated!")


def run():
    print("=" * 60)
    print("ROLLBACK: New schema -> Old Staff schema")
    print("=" * 60)
    tables = check_tables()
    with transaction.atomic():
        create_tables()
        if 'operators_operator' in tables:
            migrate_operators()
        if 'assistants_assistant' in tables:
            migrate_assistants()
        migrate_photographers()
        update_user_roles()
    verify()
    print("=" * 60)
    print("DONE. Now switch git to old main and run: python manage.py migrate")
    print("=" * 60)


run()
