from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from apps.tables.models import Table
from apps.tables.serializers import TableSerializer
from apps.tables.services import TableService
from apps.tables.selectors import TableSelector
from apps.tables.policies import TablePolicy

class TableViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        if not TablePolicy.can_manage_tables(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        name = request.data.get('name')
        organization_id = request.data.get('organization_id')
        
        table = TableService.create_table(organization_id, name, created_by=request.user)
        return Response(TableSerializer(table).data, status=status.HTTP_201_CREATED)

    def list(self, request):
        org_id = request.query_params.get('organization_id')
        tables = TableSelector.get_org_tables(org_id)
        return Response(TableSerializer(tables, many=True).data)
