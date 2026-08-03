from shared.constants import Role

class TablePolicy:
    @staticmethod
    def can_manage_tables(user) -> bool:
        return user.role in [Role.PRO_USER, Role.ADMIN, Role.CLIENT]

    @staticmethod
    def can_view_tables(user) -> bool:
        return True # Handled by selectors for tenant isolation
