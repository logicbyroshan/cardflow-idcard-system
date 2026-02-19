"""
Gunicorn Configuration for 2GB RAM Server
=========================================

CRITICAL SETTINGS:
- workers = 2 (safe for 2GB RAM — each worker ~400-600MB)
- threads = 2 (allows concurrency within each worker)
- timeout = 600 (for long bulk operations — 1GB uploads + exports)

Usage:
    gunicorn -c deployment/gunicorn.conf.py config.wsgi

Or with systemd:
    [Service]
    ExecStart=/path/to/venv/bin/gunicorn -c /path/to/deployment/gunicorn.conf.py config.wsgi
"""
import multiprocessing

# =============================================================================
# Memory-Safe Settings for 2GB RAM
# =============================================================================

# 2 workers for 2GB RAM — each worker uses ~400-600MB with image processing
# Keeps one worker available while the other handles a long upload/export
workers = 2

# Use threads for additional concurrency within each worker
threads = 2

# Process naming
proc_name = 'adarsh_gunicorn'

# =============================================================================
# Timeouts - Long for bulk operations
# =============================================================================

# Worker timeout (seconds)
# CRITICAL: Must be long for bulk uploads/exports
timeout = 600  # 10 minutes

# Graceful timeout - time to finish current request during restart
graceful_timeout = 120

# Keep-alive (seconds)
keepalive = 5

# =============================================================================
# Networking
# =============================================================================

# Bind address
bind = '127.0.0.1:8000'

# Alternative: Unix socket (slightly faster)
# bind = 'unix:/run/gunicorn/adarsh.sock'

# Backlog - number of pending connections
backlog = 128

# =============================================================================
# Worker Settings
# =============================================================================

# Worker class - sync is most memory-efficient
# Options: sync, gthread, gevent, eventlet
worker_class = 'gthread'

# Maximum requests per worker before restart (prevents memory leaks)
max_requests = 1000
max_requests_jitter = 100

# =============================================================================
# Logging
# =============================================================================

# Access log
accesslog = '/var/log/gunicorn/access.log'

# Error log
errorlog = '/var/log/gunicorn/error.log'

# Log level
loglevel = 'info'

# Access log format
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Capture stdout/stderr to error log
capture_output = True

# =============================================================================
# Process Management
# =============================================================================

# PID file
pidfile = '/run/gunicorn/adarsh.pid'

# Daemon mode (set to False for systemd)
daemon = False

# User/group to run as (for security)
# user = 'www-data'
# group = 'www-data'

# Umask
umask = 0o022

# Working directory
chdir = '/path/to/project'

# =============================================================================
# Hooks
# =============================================================================

def on_starting(server):
    """Called just before the master process is initialized."""
    pass


def on_reload(server):
    """Called before reloading the workers."""
    pass


def worker_int(worker):
    """Called when a worker receives SIGINT or SIGQUIT."""
    pass


def pre_fork(server, worker):
    """Called just before a worker is forked."""
    pass


def post_fork(server, worker):
    """Called just after a worker has been forked."""
    import os
    os.environ['GUNICORN_WORKER_READY'] = 'true'


def post_worker_init(worker):
    """Called just after a worker has initialized."""
    pass


def worker_abort(worker):
    """Called when a worker receives SIGABRT."""
    pass


def pre_exec(server):
    """Called just before a new master process is forked."""
    pass


def child_exit(server, worker):
    """Called in the master process after a worker exits."""
    pass


def worker_exit(server, worker):
    """Called in the worker process just before exit."""
    pass


def nworkers_changed(server, new_value, old_value):
    """Called when the number of workers changes."""
    pass
