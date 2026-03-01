"""
Backward-compatible shim.
Canonical location: idcards/services_workflow.py

New code should import directly from idcards.services_workflow.
"""
from idcards.services_workflow import WorkflowService  # noqa: F401


def __getattr__(name):
    if name == 'ReprintWorkflowService':
        from reprintcard.services import ReprintWorkflowService
        return ReprintWorkflowService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
