from enum import Enum
from django.db import models

class Role(models.TextChoices):
    PRO_USER = 'PRO_USER', 'Pro User'
    ADMIN = 'ADMIN', 'Admin'
    OPERATOR = 'OPERATOR', 'Operator'
    CLIENT = 'CLIENT', 'Client'
    ASSISTANT = 'ASSISTANT', 'Assistant'

class PermissionCode(models.TextChoices):
    CREATE_CLIENT = 'can_create_client', 'Can Create Client'
    EDIT_CLIENT = 'can_edit_client', 'Can Edit Client'
    DELETE_CLIENT = 'can_delete_client', 'Can Delete Client'
    CREATE_OPERATOR = 'can_create_operator', 'Can Create Operator'
    ASSIGN_OPERATOR = 'can_assign_operator', 'Can Assign Operator'
    CREATE_ASSISTANT = 'can_create_assistant', 'Can Create Assistant'
    EDIT_ASSISTANT = 'can_edit_assistant', 'Can Edit Assistant'
    DISABLE_ASSISTANT = 'can_disable_assistant', 'Can Disable Assistant'
    IMPERSONATE = 'can_impersonate', 'Can Impersonate'
    MANAGE_PERMISSIONS = 'can_manage_permissions', 'Can Manage Permissions'
    MANAGE_ORGANIZATIONS = 'can_manage_organizations', 'Can Manage Organizations'
