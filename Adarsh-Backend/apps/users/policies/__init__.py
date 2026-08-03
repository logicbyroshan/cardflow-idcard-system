from apps.users.models import User
from shared.constants import Role, PermissionCode

class ClientPolicy:
    @staticmethod
    def can_create_client(user: User) -> bool:
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        if user.role == Role.OPERATOR:
            from apps.users.services import UserService
            perms = UserService.get_user_permissions(user)
            return PermissionCode.CREATE_CLIENT in perms
        return False

    @staticmethod
    def can_edit_client(user: User, target_client: User) -> bool:
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        if user.role == Role.OPERATOR:
            # Check if operator is assigned to this client
            from apps.users.models import OperatorAssignment
            is_assigned = OperatorAssignment.objects.filter(operator=user, client=target_client).exists()
            if is_assigned:
                from apps.users.services import UserService
                perms = UserService.get_user_permissions(user)
                return PermissionCode.EDIT_CLIENT in perms
        return False
        
    @staticmethod
    def can_delete_client(user: User) -> bool:
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        if user.role == Role.OPERATOR:
            from apps.users.services import UserService
            perms = UserService.get_user_permissions(user)
            return PermissionCode.DELETE_CLIENT in perms
        return False

class OperatorPolicy:
    @staticmethod
    def can_create_operator(user: User) -> bool:
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        from apps.users.services import UserService
        perms = UserService.get_user_permissions(user)
        return PermissionCode.CREATE_OPERATOR in perms

    @staticmethod
    def can_assign_operator(user: User) -> bool:
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        from apps.users.services import UserService
        perms = UserService.get_user_permissions(user)
        return PermissionCode.ASSIGN_OPERATOR in perms

class AssistantPolicy:
    @staticmethod
    def can_create_assistant(user: User, target_client: User) -> bool:
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        if user.role == Role.CLIENT and user.id == target_client.id:
            return True
        if user.role == Role.OPERATOR:
            from apps.users.models import OperatorAssignment
            if OperatorAssignment.objects.filter(operator=user, client=target_client).exists():
                from apps.users.services import UserService
                perms = UserService.get_user_permissions(user)
                return PermissionCode.CREATE_ASSISTANT in perms
        return False

    @staticmethod
    def can_delete_assistant(user: User, assistant: User) -> bool:
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        if user.role == Role.CLIENT and assistant.parent_client_id == user.id:
            return True
        return False
