from typing import List
from apps.organizations.models import Organization

class OrganizationSelector:
    @staticmethod
    def get_all_organizations() -> List[Organization]:
        return list(Organization.objects.filter(is_deleted=False))
