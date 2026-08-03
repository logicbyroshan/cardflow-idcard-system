"""Sandbox system constants."""


class SandboxChangeType:
    FIELD_EDIT = 'FIELD_EDIT'


class SandboxWorkflowAction:
    VERIFY = 'verify'
    UNVERIFY = 'unverify'
    APPROVE = 'approve'
    UNAPPROVE = 'unapprove'
    DELETE = 'delete'
    RESTORE = 'restore'
    DOWNLOAD = 'download'


class SandboxImportStatus:
    PENDING = 'PENDING'
    PROCESSING = 'PROCESSING'
    COMPLETED = 'COMPLETED'
    FAILED = 'FAILED'


class SandboxExportStatus:
    PENDING = 'PENDING'
    PROCESSING = 'PROCESSING'
    COMPLETED = 'COMPLETED'
    FAILED = 'FAILED'


# Sandbox session lifetime in days
SESSION_TTL_DAYS = 7
