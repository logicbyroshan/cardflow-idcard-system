from apps.organizations.models import Organization
from apps.organizations.repositories import OrganizationRepository
from apps.users.services import ClientService
from django.db import transaction

class OrganizationService:
    @staticmethod
    @transaction.atomic
    def create_organization_with_owner(name: str, client_info: dict, owner_email: str, owner_username: str, owner_password: str) -> Organization:
        # 1. Create the Owner Client user temporarily without org_id
        owner_client = ClientService.create_client(
            email=owner_email,
            username=owner_username,
            password=owner_password,
            organization_id=None,
            is_owner=True
        )
        
        # 2. Create Organization
        org = OrganizationRepository.create_organization(
            name=name,
            owner_client=owner_client,
            client_information=client_info
        )
        
        # 3. Assign Org to Owner Client
        owner_client.organization_id = org.id
        owner_client.save()
        
        return org
