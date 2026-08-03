from apps.users.models import User
from shared.constants import Role, PermissionCode
from apps.users.services import UserService

class PermissionPolicy:
    @staticmethod
    def can_manage_permissions(user: User) -> bool:
        if user.role in [Role.PRO_USER, Role.ADMIN, Role.CLIENT]:
            # Clients manage their own assistants' permissions
            return True
        perms = UserService.get_user_permissions(user)
        return PermissionCode.MANAGE_PERMISSIONS in perms
