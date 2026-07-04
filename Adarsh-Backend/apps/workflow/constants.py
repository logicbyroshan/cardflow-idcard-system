class WorkflowState:
    PENDING = 'PENDING'
    VERIFIED = 'VERIFIED'
    APPROVED = 'APPROVED'
    DOWNLOADED = 'DOWNLOADED'
    DELETED = 'DELETED'

class WorkflowAction:
    VERIFY = 'verify'
    UNVERIFY = 'unverify'
    APPROVE = 'approve'
    UNAPPROVE = 'unapprove'
    DELETE = 'delete'
    RESTORE = 'restore'
    DOWNLOAD = 'download'

# Transition map showing valid (from_status, action) -> to_status
TRANSITION_MAP = {
    # PENDING
    (WorkflowState.PENDING, WorkflowAction.VERIFY): WorkflowState.VERIFIED,
    (WorkflowState.PENDING, WorkflowAction.DELETE): WorkflowState.DELETED,
    
    # VERIFIED
    (WorkflowState.VERIFIED, WorkflowAction.UNVERIFY): WorkflowState.PENDING,
    (WorkflowState.VERIFIED, WorkflowAction.APPROVE): WorkflowState.APPROVED,
    (WorkflowState.VERIFIED, WorkflowAction.DELETE): WorkflowState.DELETED,
    
    # APPROVED
    (WorkflowState.APPROVED, WorkflowAction.UNAPPROVE): WorkflowState.VERIFIED,
    (WorkflowState.APPROVED, WorkflowAction.DOWNLOAD): WorkflowState.DOWNLOADED,
    (WorkflowState.APPROVED, WorkflowAction.DELETE): WorkflowState.DELETED,
    
    # DOWNLOADED
    (WorkflowState.DOWNLOADED, WorkflowAction.DELETE): WorkflowState.DELETED,
}
