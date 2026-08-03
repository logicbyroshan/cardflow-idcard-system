from typing import List, Optional
from apps.users.models import User, OperatorAssignment
from django.db import models
from shared.constants import Role

class UserSelector:
    @staticmethod
    def get_user_by_id(user_id: str) -> Optional[User]:
        return User.objects.filter(id=user_id, is_deleted=False).first()
        
    @staticmethod
    def get_user_by_email_or_username(identifier: str) -> Optional[User]:
        return User.objects.filter(models.Q(email=identifier) | models.Q(username=identifier), is_deleted=False).first()

class ClientSelector:
    @staticmethod
    def get_organization_clients(organization_id: str) -> List[User]:
        return list(User.objects.filter(organization_id=organization_id, role=Role.CLIENT, is_deleted=False))

class AssistantSelector:
    @staticmethod
    def get_client_assistants(client_id: str) -> List[User]:
        return list(User.objects.filter(parent_client_id=client_id, role=Role.ASSISTANT, is_deleted=False))

class OperatorSelector:
    @staticmethod
    def get_assigned_clients(operator_id: str) -> List[User]:
        assignments = OperatorAssignment.objects.filter(operator_id=operator_id).select_related('client')
        return [assignment.client for assignment in assignments if not assignment.client.is_deleted]
