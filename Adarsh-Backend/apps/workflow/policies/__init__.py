from apps.cards.policies import CardPolicy
from shared.constants import Role

class WorkflowPolicy:
    @staticmethod
    def _has_org_access(user, card) -> bool:
        if not user or not user.is_authenticated:
            return False
            
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
            
        if user.role == Role.CLIENT:
            if not CardPolicy.can_access_card(user, card):
                return False
            return str(card.organization_id) == str(user.organization_id)
            
        if user.role == Role.OPERATOR:
            from apps.users.models import OperatorAssignment
            if user.organization_id and str(card.organization_id) == str(user.organization_id):
                return True
            return OperatorAssignment.objects.filter(operator=user, client__organization_id=card.organization_id).exists()
            
        if user.role == Role.ASSISTANT:
            if not CardPolicy.can_access_card(user, card):
                return False
            return str(card.organization_id) == str(user.organization_id)
            
        return False

    @classmethod
    def can_verify(cls, user, card) -> bool:
        if not cls._has_org_access(user, card):
            return False
        return user.role in [Role.PRO_USER, Role.ADMIN, Role.CLIENT, Role.OPERATOR]

    @classmethod
    def can_unverify(cls, user, card) -> bool:
        return cls.can_verify(user, card)

    @classmethod
    def can_approve(cls, user, card) -> bool:
        if not cls._has_org_access(user, card):
            return False
        return user.role in [Role.PRO_USER, Role.ADMIN, Role.CLIENT]

    @classmethod
    def can_unapprove(cls, user, card) -> bool:
        return cls.can_approve(user, card)

    @classmethod
    def can_delete(cls, user, card) -> bool:
        if not cls._has_org_access(user, card):
            return False
        return user.role in [Role.PRO_USER, Role.ADMIN, Role.CLIENT]

    @classmethod
    def can_restore(cls, user, card) -> bool:
        if not cls._has_org_access(user, card):
            return False
        return user.role in [Role.PRO_USER, Role.ADMIN, Role.CLIENT]

    @classmethod
    def can_download(cls, user, card) -> bool:
        if not cls._has_org_access(user, card):
            return False
        return user.role in [Role.PRO_USER, Role.ADMIN, Role.CLIENT, Role.OPERATOR, Role.ASSISTANT]
