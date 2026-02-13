"""
Django management command to clean up background tasks.

Usage:
    python manage.py cleanup_tasks
    python manage.py cleanup_tasks --all
    python manage.py cleanup_tasks --stale-hours=48 --old-days=14

Should be run periodically via cron:
    0 2 * * * cd /path/to/project && python manage.py cleanup_tasks --all
"""
from django.core.management.base import BaseCommand, CommandError

from core.services.task_cleanup import (
    cleanup_stale_tasks,
    cleanup_old_results,
    cleanup_orphaned_temp_files,
    cleanup_old_exports,
    run_all_cleanup,
    ensure_directories,
)


class Command(BaseCommand):
    help = 'Clean up background tasks, temporary files, and old exports'

    def add_arguments(self, parser):
        parser.add_argument(
            '--all',
            action='store_true',
            help='Run all cleanup operations',
        )
        parser.add_argument(
            '--stale',
            action='store_true',
            help='Mark stale (stuck) tasks as failed',
        )
        parser.add_argument(
            '--old',
            action='store_true',
            help='Delete old completed task records',
        )
        parser.add_argument(
            '--temp',
            action='store_true',
            help='Delete orphaned temp files',
        )
        parser.add_argument(
            '--exports',
            action='store_true',
            help='Delete old export files',
        )
        parser.add_argument(
            '--stale-hours',
            type=int,
            default=24,
            help='Hours after which a processing task is considered stale (default: 24)',
        )
        parser.add_argument(
            '--old-days',
            type=int,
            default=7,
            help='Days after which completed tasks are deleted (default: 7)',
        )
        parser.add_argument(
            '--temp-hours',
            type=int,
            default=24,
            help='Hours after which temp files are deleted (default: 24)',
        )
        parser.add_argument(
            '--export-days',
            type=int,
            default=3,
            help='Days after which export files are deleted (default: 3)',
        )

    def handle(self, *args, **options):
        # Ensure directories exist
        ensure_directories()
        
        # If --all or no specific option, run all cleanup
        if options['all'] or not any([
            options['stale'],
            options['old'],
            options['temp'],
            options['exports'],
        ]):
            self.stdout.write('Running all cleanup operations...')
            results = run_all_cleanup()
            
            self.stdout.write(self.style.SUCCESS(
                f"Cleanup completed:\n"
                f"  - Stale tasks marked failed: {results['stale_tasks']}\n"
                f"  - Old task records deleted: {results['old_results']}\n"
                f"  - Orphaned temp files deleted: {results['orphaned_temp']}\n"
                f"  - Old export files deleted: {results['old_exports']}"
            ))
            return
        
        # Run specific cleanup operations
        results = {}
        
        if options['stale']:
            count = cleanup_stale_tasks(hours=options['stale_hours'])
            results['stale_tasks'] = count
            self.stdout.write(f'Marked {count} stale tasks as failed')
        
        if options['old']:
            count = cleanup_old_results(days=options['old_days'])
            results['old_results'] = count
            self.stdout.write(f'Deleted {count} old task records')
        
        if options['temp']:
            count = cleanup_orphaned_temp_files(hours=options['temp_hours'])
            results['orphaned_temp'] = count
            self.stdout.write(f'Deleted {count} orphaned temp files')
        
        if options['exports']:
            count = cleanup_old_exports(days=options['export_days'])
            results['old_exports'] = count
            self.stdout.write(f'Deleted {count} old export files')
        
        total = sum(results.values())
        self.stdout.write(self.style.SUCCESS(f'Total items cleaned: {total}'))
