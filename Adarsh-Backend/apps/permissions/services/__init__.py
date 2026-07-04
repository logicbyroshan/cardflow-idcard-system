from typing import List
from apps.users.models import User
from apps.permissions.repositories import PermissionRepository

class PermissionService:
    @staticmethod
    def override_user_permission(user: User, permission_code: str, is_granted: bool) -> None:
        PermissionRepository.set_user_permission_override(user, permission_code, is_granted)

    @staticmethod
    def get_user_permissions(user: User) -> List[str]:
        return PermissionRepository.get_user_permissions(user)
