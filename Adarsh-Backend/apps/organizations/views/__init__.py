from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from apps.organizations.serializers import OrganizationSerializer, CreateOrganizationRequestSerializer
from apps.organizations.services import OrganizationService
from apps.organizations.selectors import OrganizationSelector
from apps.organizations.policies import OrganizationPolicy

class OrganizationViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        if not OrganizationPolicy.can_manage_organizations(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        serializer = CreateOrganizationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        data = serializer.validated_data
        org = OrganizationService.create_organization_with_owner(
            name=data['name'],
            client_info=data.get('client_information', {}),
            owner_email=data['owner_email'],
            owner_username=data['owner_username'],
            owner_password=data['owner_password']
        )
        return Response(OrganizationSerializer(org).data, status=status.HTTP_201_CREATED)

    def list(self, request):
        if not OrganizationPolicy.can_manage_organizations(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        orgs = OrganizationSelector.get_all_organizations()
        return Response(OrganizationSerializer(orgs, many=True).data)
