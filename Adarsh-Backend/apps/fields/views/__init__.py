from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from apps.fields.serializers import FieldSerializer
from apps.fields.services import FieldService
from apps.fields.selectors import FieldSelector
from apps.fields.policies import FieldPolicy

class FieldViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        if not FieldPolicy.can_manage_fields(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        table_id = request.data.get('table_id')
        name = request.data.get('name')
        type_str = request.data.get('type')
        is_unique = request.data.get('is_unique', False)
        
        field = FieldService.create_field(
            table_id=table_id,
            name=name,
            type=type_str,
            is_unique=is_unique,
            created_by=request.user
        )
        return Response(FieldSerializer(field).data, status=status.HTTP_201_CREATED)

    def list(self, request):
        table_id = request.query_params.get('table_id')
        fields = FieldSelector.get_table_fields(table_id)
        return Response(FieldSerializer(fields, many=True).data)
