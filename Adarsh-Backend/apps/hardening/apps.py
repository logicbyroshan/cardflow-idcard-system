import sys
import time
import logging
from django.apps import AppConfig
from django.db import connection

logger = logging.getLogger(__name__)

def slow_query_wrapper(execute, sql, params, many, context):
    """
    Database query execution wrapper.
    Measures query latency and logs warnings for queries taking > 500ms.
    """
    start_time = time.monotonic()
    try:
        return execute(sql, params, many, context)
    finally:
        duration = (time.monotonic() - start_time) * 1000
        if duration > 500.0:  # 500 ms threshold
            # Truncate long SQL statements in logs
            sql_preview = sql[:400] + "..." if len(sql) > 400 else sql
            logger.warning(
                f"Slow Query Detected: {duration:.2f}ms | SQL: {sql_preview}",
                extra={
                    "sql": sql,
                    "duration_ms": duration,
                }
            )

class HardeningConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.hardening'

    def ready(self):
        # 1. Register database query execution wrapper for slow query logging
        connection.execute_wrappers.append(slow_query_wrapper)
        
        # 2. Trigger startup validator
        # Bypass during migrations or CLI commands that don't need validation
        run_validation = True
        
        # Avoid breaking test runs or setup if environment is stubbed
        # Check if running tests, migrations, or generating docs
        bypass_args = ['makemigrations', 'migrate', 'collectstatic', 'help', 'spectacular']
        for arg in bypass_args:
            if arg in sys.argv:
                run_validation = False
                break
                
        if run_validation:
            from apps.hardening.services import StartupValidator
            StartupValidator.validate()
