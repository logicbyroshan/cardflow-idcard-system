"""
Task Manager — Track and manage long-running operations in Adarsh Engine.

Allows:
  - Registering a task (get task ID)
  - Checking if a task should be cancelled
  - Cancelling a task
  - Marking task completion

Used by processing endpoints to support mid-flight cancellation without
stopping the entire engine.
"""
import threading
import time
import uuid
from datetime import datetime
from typing import Optional

# Global state
_lock = threading.Lock()
_active_tasks: dict[str, dict] = {}


class TaskInfo:
    """Metadata about an active or recently-completed task."""
    
    def __init__(self, task_id: str, operation: str):
        self.task_id = task_id
        self.operation = operation  # "process", "compress", "crop", etc.
        self.created_at = time.time()
        self.start_at: Optional[float] = None
        self.end_at: Optional[float] = None
        self.should_cancel = False
        self.status = "pending"  # pending → running → completed/cancelled
        self.progress: dict = {}  # Operation-specific progress data
        self.result: Optional[dict] = None
        self.error: Optional[str] = None
    
    def to_dict(self) -> dict:
        """Export task state as JSON-serializable dict."""
        return {
            "task_id": self.task_id,
            "operation": self.operation,
            "status": self.status,
            "created_at": self.created_at,
            "start_at": self.start_at,
            "end_at": self.end_at,
            "duration_seconds": round(
                (self.end_at or time.time()) - (self.start_at or self.created_at), 2
            ) if self.start_at else None,
            "progress": self.progress,
            "result": self.result,
            "error": self.error,
        }


def create_task(operation: str) -> str:
    """
    Create a new task and return its ID.
    Task starts in 'pending' state.
    """
    task_id = str(uuid.uuid4())
    task = TaskInfo(task_id, operation)
    
    with _lock:
        _active_tasks[task_id] = task
    
    return task_id


def get_task(task_id: str) -> Optional[TaskInfo]:
    """Retrieve a task by ID (returns None if not found)."""
    with _lock:
        return _active_tasks.get(task_id)


def start_task(task_id: str) -> bool:
    """Mark a task as 'running'. Returns True if successful."""
    task = get_task(task_id)
    if not task:
        return False
    
    with _lock:
        if task.status == "pending":
            task.status = "running"
            task.start_at = time.time()
            return True
    return False


def should_cancel_task(task_id: str) -> bool:
    """Check if a task should be cancelled (called by processing logic)."""
    task = get_task(task_id)
    return task and task.should_cancel


def cancel_task(task_id: str) -> bool:
    """
    Request cancellation of a task.
    Returns True if the task was found and marked for cancellation.
    """
    task = get_task(task_id)
    if task and task.status == "running":
        task.should_cancel = True
        return True
    return False


def update_progress(task_id: str, progress_data: dict) -> bool:
    """Update progress info for a running task."""
    task = get_task(task_id)
    if task and task.status == "running":
        task.progress = progress_data
        return True
    return False


def complete_task(task_id: str, result: Optional[dict] = None) -> bool:
    """Mark a task as completed with optional result data."""
    task = get_task(task_id)
    if task:
        with _lock:
            task.status = "completed"
            task.end_at = time.time()
            task.result = result
            task.should_cancel = False
        return True
    return False


def fail_task(task_id: str, error: str) -> bool:
    """Mark a task as failed with error message."""
    task = get_task(task_id)
    if task:
        with _lock:
            task.status = "failed"
            task.end_at = time.time()
            task.error = error
            task.should_cancel = False
        return True
    return False


def cancel_by_request(task_id: str) -> bool:
    """Mark a task as cancelled by user request."""
    task = get_task(task_id)
    if task:
        with _lock:
            task.status = "cancelled"
            task.end_at = time.time()
            task.should_cancel = True
        return True
    return False


def cleanup_old_tasks(max_age_seconds: int = 3600) -> int:
    """
    Remove completed/failed/cancelled tasks older than max_age_seconds.
    Returns count of removed tasks.
    """
    now = time.time()
    removed = 0
    
    with _lock:
        to_delete = [
            task_id for task_id, task in _active_tasks.items()
            if task.status in ("completed", "failed", "cancelled")
            and task.end_at and (now - task.end_at) > max_age_seconds
        ]
        for task_id in to_delete:
            del _active_tasks[task_id]
            removed += 1
    
    return removed


def get_current_task() -> Optional[dict]:
    """Return the currently active task (running status), or None."""
    with _lock:
        for task in _active_tasks.values():
            if task.status == "running":
                return task.to_dict()
    return None


def get_all_tasks() -> list[dict]:
    """Return all task states (active and recent)."""
    with _lock:
        return [task.to_dict() for task in _active_tasks.values()]
