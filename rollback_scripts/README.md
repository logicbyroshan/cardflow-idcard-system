# Rollback Scripts

This directory contains scripts for safely rolling back from the new operator/assistant/photographer schema
back to the old core_staff-based schema.

## When to use

Use rollback_to_staff_schema.py BEFORE switching git main branch back to the June 22 commit.
Run it while the new codebase (with operator/assistant/photographer tables) is still active.

## How to run

On the server (or locally), with the virtual environment activated:

    python manage.py shell < rollback_scripts/rollback_to_staff_schema.py

## What it does

1. Creates core_staff, core_staff_assigned_clients, core_staff_assigned_groups tables
2. Copies all Operator records -> Staff(staff_type=admin_staff) with all permissions preserved
3. Copies all Assistant records -> Staff(staff_type=client_staff) with all permissions + client assignment preserved
4. Creates a minimal admin_staff record for any Photographer users
5. Updates all User.role: operator->admin_staff, assistant->client_staff, photographer->admin_staff
6. Prints a verification summary

## After running the script

Switch git to old main, then: python manage.py migrate --run-syncdb

## Safety notes

The script is atomic (wrapped in a single transaction). If anything fails, no changes are committed.
It refuses to run if core_staff already has rows (prevents double-run).
