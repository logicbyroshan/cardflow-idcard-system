from django.apps import AppConfig

class SandboxConfig(AppConfig):
    name = 'apps.sandbox'
    verbose_name = 'Sandbox'

    def ready(self):
        pass
