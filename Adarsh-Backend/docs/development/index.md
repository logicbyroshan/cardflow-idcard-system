# Development Handbook

## Creating a New Domain App
1. Run `python manage.py startapp <name> apps/<name>`.
2. Add to `INSTALLED_APPS` in `base.py`.
3. Create the standard folders: `selectors/`, `repositories/`, `services/`, `policies/`, `events/`.

## Creating a Service
Services must orchestrate, not persist directly:
```python
# apps/cards/services/card_creation.py
class CardCreationService:
    def __init__(self, repo: CardRepository):
        self.repo = repo
        
    def execute(self, user, data: dict):
        CanCreateCardPolicy.check(user)
        # Business logic here
        return self.repo.create(data)
```

## Creating a Policy
```python
class CanCreateCardPolicy:
    @staticmethod
    def check(user):
        if not user.has_perm('cards.create'):
            raise PermissionDenied("Cannot create cards")
```\n