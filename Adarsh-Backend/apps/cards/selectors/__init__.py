from apps.cards.models import Card, AssistantFilter, CardStatus
from typing import Optional

class CardSelector:
    @staticmethod
    def get_card(card_id: str) -> Optional[Card]:
        return Card.objects.filter(id=card_id).first()

    @staticmethod
    def get_table_cards(table_id: str, assistant=None, status: Optional[str] = None, query: Optional[str] = None):
        if status is None:
            status = CardStatus.ACTIVE
            
        queryset = Card.objects.filter(table_id=table_id)
        if status != 'ALL':
            queryset = queryset.filter(status=status)
            
        if query:
            from django.db.models import Q
            queryset = queryset.filter(
                Q(display_id__icontains=query) | Q(data__icontains=query)
            )
            
        if assistant:
            # Apply assistant filters
            filters = AssistantFilter.objects.filter(assistant=assistant, table_id=table_id)
            for f in filters:
                for field_id, allowed_values in f.criteria.items():
                    # JSONB query: data__<field_id>__in=allowed_values
                    kwargs = {f"data__{field_id}__in": allowed_values}
                    queryset = queryset.filter(**kwargs)
                    
        return queryset

    @staticmethod
    def global_search(organization_id: str, query: str):
        from django.db.models import Q
        return Card.objects.filter(
            Q(display_id__icontains=query) | Q(data__icontains=query),
            organization_id=organization_id,
            status=CardStatus.ACTIVE
        )
