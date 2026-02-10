from django.apps import AppConfig


class ClientStaffConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'client_staff'
    verbose_name = 'Client Staff Management'
    
    def ready(self):
        """
        Initialize the app - create default permissions and groups.
        This runs when Django starts.
        """
        # Import signal handlers or run initialization code
        pass
