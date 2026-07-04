from django.db.models import Count, Q
from rest_framework.exceptions import PermissionDenied
from apps.cards.models import Card, AssistantFilter
from apps.cards.policies import CardPolicy
from apps.workflow.constants import WorkflowState
from shared.constants import Role

class WorkflowSelector:
    @staticmethod
    def can_access_table_for_workflow(user, table_id: str) -> bool:
        if not user or not user.is_authenticated:
            return False
        if user.role in [Role.PRO_USER, Role.ADMIN]:
            return True
        if user.role == Role.CLIENT:
            from apps.tables.selectors import TableSelector
            table = TableSelector.get_table(table_id)
            return table is not None and str(table.organization_id) == str(user.organization_id)
        if user.role == Role.OPERATOR:
            from apps.tables.selectors import TableSelector
            from apps.users.models import OperatorAssignment
            table = TableSelector.get_table(table_id)
            if not table:
                return False
            if user.organization_id and str(table.organization_id) == str(user.organization_id):
                return True
            return OperatorAssignment.objects.filter(operator=user, client__organization_id=table.organization_id).exists()
        if user.role == Role.ASSISTANT:
            return AssistantFilter.objects.filter(assistant=user, table_id=table_id).exists()
        return False

    @staticmethod
    def get_counts_by_status(table_id: str, user) -> dict:
        if not WorkflowSelector.can_access_table_for_workflow(user, table_id):
            raise PermissionDenied("Access denied to table.")
            
        queryset = Card.objects.filter(table_id=table_id)
        
        # Apply assistant filter
        if user.role == Role.ASSISTANT:
            filters = AssistantFilter.objects.filter(assistant=user, table_id=table_id)
            for f in filters:
                for field_id, allowed_values in f.criteria.items():
                    kwargs = {f"data__{field_id}__in": allowed_values}
                    queryset = queryset.filter(**kwargs)
                    
        # Group by status
        counts_data = queryset.values('status').annotate(count=Count('id'))
        
        # Build mapping and default all states to 0
        counts_dict = {
            WorkflowState.PENDING: 0,
            WorkflowState.VERIFIED: 0,
            WorkflowState.APPROVED: 0,
            WorkflowState.DOWNLOADED: 0,
            WorkflowState.DELETED: 0
        }
        
        for item in counts_data:
            status_val = item['status']
            if status_val in counts_dict:
                counts_dict[status_val] = item['count']
                
        return counts_dict

    @staticmethod
    def get_workflow_cards(table_id: str, user, status: str = None, query: str = None):
        if not WorkflowSelector.can_access_table_for_workflow(user, table_id):
            raise PermissionDenied("Access denied to table.")
            
        queryset = Card.objects.filter(table_id=table_id)
        
        if status:
            queryset = queryset.filter(status=status)
            
        if query:
            queryset = queryset.filter(
                Q(display_id__icontains=query) | Q(data__icontains=query)
            )
            
        # Apply assistant filter
        if user.role == Role.ASSISTANT:
            filters = AssistantFilter.objects.filter(assistant=user, table_id=table_id)
            for f in filters:
                for field_id, allowed_values in f.criteria.items():
                    kwargs = {f"data__{field_id}__in": allowed_values}
                    queryset = queryset.filter(**kwargs)
                    
        return queryset
