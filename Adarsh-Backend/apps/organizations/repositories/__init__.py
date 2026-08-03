from typing import Optional
from apps.organizations.models import Organization
from apps.users.models import User

class OrganizationRepository:
    @staticmethod
    def create_organization(name: str, owner_client: User, client_information: dict) -> Organization:
        return Organization.objects.create(
            name=name,
            owner_client=owner_client,
            client_information=client_information
        )

    @staticmethod
    def get_by_id(org_id: str) -> Optional[Organization]:
        return Organization.objects.filter(id=org_id, is_deleted=False).first()
