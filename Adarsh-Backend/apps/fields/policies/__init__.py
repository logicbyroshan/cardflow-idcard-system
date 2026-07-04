from shared.constants import Role

class FieldPolicy:
    @staticmethod
    def can_manage_fields(user) -> bool:
        return user.role in [Role.PRO_USER, Role.ADMIN, Role.CLIENT]
