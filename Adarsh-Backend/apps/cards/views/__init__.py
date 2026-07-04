from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from django.db import transaction
from apps.cards.serializers import CardSerializer
from apps.cards.services import CardService, StaleWriteError
from apps.cards.selectors import CardSelector
from apps.cards.policies import CardPolicy
from apps.tables.selectors import TableSelector
from shared.constants import Role
from rest_framework.exceptions import ValidationError

class CardViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        if not CardPolicy.can_manage_cards(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        table_id = request.data.get('table_id')
        data = request.data.get('data', {})
        
        table = TableSelector.get_table(table_id)
        if not table:
            return Response({'error': 'Table not found'}, status=status.HTTP_404_NOT_FOUND)
            
        # Security Policy Check
        if not CardPolicy.can_write_card_data(request.user, str(table.id), data):
            return Response({'error': 'Access denied or data does not match filter criteria'}, status=status.HTTP_403_FORBIDDEN)
            
        try:
            card = CardService.create_card(table, str(table.organization_id), data, created_by=request.user)
            return Response(CardSerializer(card).data, status=status.HTTP_201_CREATED)
        except ValidationError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def list(self, request):
        table_id = request.query_params.get('table_id')
        status_param = request.query_params.get('status')
        query_param = request.query_params.get('q')
        
        if not table_id:
            return Response({'error': 'table_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            
        # Security Policy Check
        if not CardPolicy.can_access_table(request.user, table_id):
            return Response({'error': 'Access denied to table'}, status=status.HTTP_403_FORBIDDEN)
            
        # Resolve assistant context
        assistant = None
        if request.user.role == Role.ASSISTANT:
            assistant = request.user
            
        cards = CardSelector.get_table_cards(table_id, assistant=assistant, status=status_param, query=query_param)
        return Response(CardSerializer(cards, many=True).data)
        
    def partial_update(self, request, pk=None):
        if not CardPolicy.can_manage_cards(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        card = CardSelector.get_card(pk)
        if not card:
            return Response({'error': 'Card not found'}, status=status.HTTP_404_NOT_FOUND)
            
        # Security Policy Check for current card
        if not CardPolicy.can_access_card(request.user, card):
            return Response({'error': 'Access denied to card'}, status=status.HTTP_403_FORBIDDEN)
            
        data_update = request.data.get('data', {})
        expected_version = request.data.get('version')
        
        if expected_version is None:
            return Response({'error': 'version is required for optimistic locking'}, status=status.HTTP_400_BAD_REQUEST)
            
        # Security Policy Check for updated card data
        merged_data = dict(card.data)
        merged_data.update(data_update)
        if not CardPolicy.can_write_card_data(request.user, str(card.table_id), merged_data):
            return Response({'error': 'Updated data violates filter criteria'}, status=status.HTTP_403_FORBIDDEN)
            
        try:
            updated_card = CardService.update_card(card, data_update, int(expected_version), updated_by=request.user)
            return Response(CardSerializer(updated_card).data)
        except StaleWriteError as e:
            return Response({'error': str(e)}, status=status.HTTP_409_CONFLICT)
        except ValidationError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def destroy(self, request, pk=None):
        if not CardPolicy.can_manage_cards(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        card = CardSelector.get_card(pk)
        if not card:
            return Response({'error': 'Card not found'}, status=status.HTTP_404_NOT_FOUND)
            
        # Security Policy Check
        if not CardPolicy.can_access_card(request.user, card):
            return Response({'error': 'Access denied to card'}, status=status.HTTP_403_FORBIDDEN)
            
        CardService.delete_card(card, deleted_by=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['patch'])
    @transaction.atomic
    def bulk_update(self, request):
        if not CardPolicy.can_manage_cards(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        updates = request.data.get('updates', [])
        if not isinstance(updates, list):
            return Response({'error': 'updates must be a list'}, status=status.HTTP_400_BAD_REQUEST)
            
        results = []
        
        for index, update_data in enumerate(updates):
            card_id = update_data.get('id')
            data_update = update_data.get('data', {})
            expected_version = update_data.get('version')
            
            if not card_id or expected_version is None:
                raise ValidationError(f'id and version are required at index {index}')
                
            card = CardSelector.get_card(card_id)
            if not card:
                raise ValidationError(f'Card {card_id} not found')
                
            # Security Policy Check
            if not CardPolicy.can_access_card(request.user, card):
                raise ValidationError(f'Access denied to card {card_id}')
                
            merged_data = dict(card.data)
            merged_data.update(data_update)
            if not CardPolicy.can_write_card_data(request.user, str(card.table_id), merged_data):
                raise ValidationError(f'Updated data violates filter criteria at card {card_id}')
                
            try:
                updated_card = CardService.update_card(card, data_update, int(expected_version), updated_by=request.user)
                results.append(CardSerializer(updated_card).data)
            except StaleWriteError as e:
                raise ValidationError(f"Stale write at card {card_id}: {str(e)}")
            except ValidationError as e:
                raise ValidationError(f"Validation failed at card {card_id}: {str(e)}")
                
        return Response({'updated': results})

    @action(detail=False, methods=['get'])
    def search(self, request):
        query = request.query_params.get('q', '')
        organization_id = request.query_params.get('organization_id')
        
        cards = CardSelector.global_search(organization_id, query)
        return Response(CardSerializer(cards, many=True).data)
