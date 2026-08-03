from django.apps import AppConfig

class WorkflowConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.workflow'

    def ready(self):
        # 1. Import signal handlers
        import apps.workflow.signals

        # 2. Monkey-patch CardSelector.global_search and CardSelector.get_table_cards
        from apps.cards.selectors import CardSelector
        from apps.cards.models import Card
        from django.db.models import Q

        # Save reference to original selectors
        CardSelector._original_global_search = CardSelector.global_search
        CardSelector._original_get_table_cards = CardSelector.get_table_cards

        @staticmethod
        def patched_global_search(organization_id: str, query: str):
            # Original search only matched CardStatus.ACTIVE.
            # In Phase 7, active status is any workflow state other than DELETED.
            return Card.objects.filter(
                Q(display_id__icontains=query) | Q(data__icontains=query),
                organization_id=organization_id,
                status__in=['PENDING', 'VERIFIED', 'APPROVED', 'DOWNLOADED', 'ACTIVE']
            )

        @staticmethod
        def patched_get_table_cards(table_id: str, assistant=None, status=None, query=None):
            # If status is not provided, it defaults to ACTIVE.
            # We map ACTIVE to all non-deleted states in the new system.
            if status is None or status == 'ACTIVE':
                status_filter = ['PENDING', 'VERIFIED', 'APPROVED', 'DOWNLOADED', 'ACTIVE']
            elif status == 'ALL':
                status_filter = None
            else:
                status_filter = [status]

            queryset = Card.objects.filter(table_id=table_id)
            if status_filter is not None:
                queryset = queryset.filter(status__in=status_filter)

            if query:
                queryset = queryset.filter(
                    Q(display_id__icontains=query) | Q(data__icontains=query)
                )

            if assistant:
                from apps.cards.models import AssistantFilter
                filters = AssistantFilter.objects.filter(assistant=assistant, table_id=table_id)
                for f in filters:
                    for field_id, allowed_values in f.criteria.items():
                        kwargs = {f"data__{field_id}__in": allowed_values}
                        queryset = queryset.filter(**kwargs)

            return queryset

        CardSelector.global_search = patched_global_search
        CardSelector.get_table_cards = patched_get_table_cards
