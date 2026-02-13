"""
Gunicorn Configuration for 1GB RAM Server
=========================================

CRITICAL SETTINGS:
- workers = 1 (NEVER increase on 1GB RAM)
- threads = 2 (allows some concurrency)
- timeout = 600 (for long bulk operations)

Usage:
    gunicorn -c deployment/gunicorn.conf.py config.wsgi

Or with systemd:
    [Service]
    ExecStart=/path/to/venv/bin/gunicorn -c /path/to/deployment/gunicorn.conf.py config.wsgi
"""
import multiprocessing

# =============================================================================
# CRITICAL: Memory-Safe Settings for 1GB RAM
# =============================================================================

# NEVER use more than 1 worker on 1GB RAM!
# Each worker consumes ~200-400MB with image processing
workers = 1

# Use threads instead of multiple workers for concurrency
# This allows handling multiple requests with shared memory
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
