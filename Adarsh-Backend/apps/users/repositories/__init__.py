from typing import Optional, List
from apps.users.models import User, OperatorAssignment
from shared.constants import Role

class UserRepository:
    @staticmethod
    def get_by_id(user_id: str) -> Optional[User]:
        return User.objects.filter(id=user_id, is_deleted=False).first()

    @staticmethod
    def get_by_email(email: str) -> Optional[User]:
        return User.objects.filter(email=email, is_deleted=False).first()

    @staticmethod
    def get_by_username(username: str) -> Optional[User]:
        return User.objects.filter(username=username, is_deleted=False).first()

    @staticmethod
    def create_user(role: str, **kwargs) -> User:
        return User.objects.create_user(role=role, **kwargs)
        
    @staticmethod
    def update(user: User, **kwargs) -> User:
        for key, value in kwargs.items():
            setattr(user, key, value)
        user.save()
        return user

class ClientRepository:
    @staticmethod
    def get_by_id(client_id: str) -> Optional[User]:
        return User.objects.filter(id=client_id, role=Role.CLIENT, is_deleted=False).first()

    @staticmethod
    def get_all_by_organization(organization_id: str) -> List[User]:
        return list(User.objects.filter(organization_id=organization_id, role=Role.CLIENT, is_deleted=False))

class AssistantRepository:
    @staticmethod
    def get_by_id(assistant_id: str) -> Optional[User]:
        return User.objects.filter(id=assistant_id, role=Role.ASSISTANT, is_deleted=False).first()

    @staticmethod
    def hard_delete(assistant: User) -> None:
        assistant.delete()

class OperatorAssignmentRepository:
    @staticmethod
    def create_assignment(operator: User, client: User, assigned_by: User) -> OperatorAssignment:
        return OperatorAssignment.objects.create(
            operator=operator,
            client=client,
            assigned_by=assigned_by
        )

    @staticmethod
    def get_assignments_for_operator(operator_id: str) -> List[OperatorAssignment]:
        return list(OperatorAssignment.objects.filter(operator_id=operator_id).select_related('client'))
