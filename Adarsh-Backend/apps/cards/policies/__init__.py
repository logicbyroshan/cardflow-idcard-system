from shared.constants import Role
from apps.cards.models import AssistantFilter, Card

class CardPolicy:
    @staticmethod
    def can_manage_cards(user) -> bool:
        return user.role in [Role.PRO_USER, Role.ADMIN, Role.CLIENT, Role.ASSISTANT]

    @staticmethod
    def can_access_table(user, table_id: str) -> bool:
        if not user or not user.is_authenticated:
            return False
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        if user.role == Role.CLIENT:
            from apps.tables.selectors import TableSelector
            table = TableSelector.get_table(table_id)
            return table is not None and str(table.organization_id) == str(user.organization_id)
        if user.role == Role.ASSISTANT:
            # Must be assigned to this table via AssistantFilter
            return AssistantFilter.objects.filter(assistant=user, table_id=table_id).exists()
        return False

    @staticmethod
    def can_access_card(user, card: Card) -> bool:
        if not CardPolicy.can_access_table(user, str(card.table_id)):
            return False
        if user.role == Role.ASSISTANT:
            filters = AssistantFilter.objects.filter(assistant=user, table_id=card.table_id)
            for f in filters:
                for field_id, allowed_values in f.criteria.items():
                    val = card.data.get(str(field_id))
                    if val not in allowed_values:
                        return False
        return True

    @staticmethod
    def can_write_card_data(user, table_id: str, data: dict) -> bool:
        if not CardPolicy.can_access_table(user, table_id):
            return False
        if user.role == Role.ASSISTANT:
            filters = AssistantFilter.objects.filter(assistant=user, table_id=table_id)
            for f in filters:
                for field_id, allowed_values in f.criteria.items():
                    val = data.get(str(field_id))
                    if val not in allowed_values:
                        return False
        return True
