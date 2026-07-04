from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from apps.cards.serializers import CardSerializer
from apps.cards.selectors import CardSelector
from apps.workflow.services import WorkflowService
from apps.workflow.selectors import WorkflowSelector

class WorkflowViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='counts')
    def counts(self, request):
        table_id = request.query_params.get('table_id')
        if not table_id:
            raise ValidationError("table_id is required.")
        counts = WorkflowSelector.get_counts_by_status(table_id, request.user)
        return Response(counts)

    @action(detail=False, methods=['post'], url_path='transition')
    def transition(self, request):
        card_id = request.data.get('card_id')
        action_name = request.data.get('action')
        reason = request.data.get('reason')
        
        if not card_id or not action_name:
            raise ValidationError("card_id and action are required.")
            
        card = CardSelector.get_card(card_id)
        if not card:
            return Response({'error': 'Card not found.'}, status=status.HTTP_404_NOT_FOUND)
            
        updated_card = WorkflowService.transition_card(card, action_name, request.user, reason)
        return Response(CardSerializer(updated_card).data)

    @action(detail=False, methods=['post'], url_path='bulk')
    def bulk_transition(self, request):
        table_id = request.data.get('table_id')
        action_name = request.data.get('action')
        card_ids = request.data.get('card_ids')
        reason = request.data.get('reason')
        
        if not table_id or not action_name or not card_ids:
            raise ValidationError("table_id, action, and card_ids are required.")
            
        if not isinstance(card_ids, list):
            raise ValidationError("card_ids must be a list.")
            
        updated_cards = WorkflowService.bulk_transition(table_id, action_name, card_ids, request.user, reason)
        return Response(CardSerializer(updated_cards, many=True).data)

    @action(detail=False, methods=['get'], url_path='cards')
    def list_cards(self, request):
        table_id = request.query_params.get('table_id')
        status_param = request.query_params.get('status')
        query_param = request.query_params.get('q')
        
        if not table_id:
            raise ValidationError("table_id is required.")
            
        cards = WorkflowSelector.get_workflow_cards(table_id, request.user, status_param, query_param)
        return Response(CardSerializer(cards, many=True).data)
