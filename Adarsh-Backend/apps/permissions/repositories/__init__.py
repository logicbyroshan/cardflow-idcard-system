from typing import List
from apps.permissions.models import Permission, RolePermission, UserPermission
from apps.users.models import User
from shared.constants import Role

class PermissionRepository:
    @staticmethod
    def get_all_permissions() -> List[Permission]:
        return list(Permission.objects.all())

    @staticmethod
    def get_user_permissions(user: User) -> List[str]:
        # 1. Base Role permissions
        role_perms = list(RolePermission.objects.filter(role=user.role).values_list('permission__code', flat=True))
        
        # 2. Overrides
        overrides = UserPermission.objects.filter(user=user).select_related('permission')
        
        final_perms = set(role_perms)
        for override in overrides:
            if override.is_granted:
                final_perms.add(override.permission.code)
            else:
                final_perms.discard(override.permission.code)
                
        return list(final_perms)

    @staticmethod
    def set_user_permission_override(user: User, permission_code: str, is_granted: bool) -> UserPermission:
        permission = Permission.objects.get(code=permission_code)
        override, created = UserPermission.objects.update_or_create(
            user=user,
            permission=permission,
            defaults={'is_granted': is_granted}
        )
        return override
