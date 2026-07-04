from apps.users.models import User
from shared.constants import Role, PermissionCode
from apps.users.services import UserService

class OrganizationPolicy:
    @staticmethod
    def can_manage_organizations(user: User) -> bool:
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        perms = UserService.get_user_permissions(user)
        return PermissionCode.MANAGE_ORGANIZATIONS in perms
