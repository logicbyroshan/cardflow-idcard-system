import uuid
from django.utils.deprecation import MiddlewareMixin
from apps.hardening.context import set_request_context, clear_request_context

class RequestCorrelationMiddleware(MiddlewareMixin):
    """
    Ensures every HTTP request gets a unique request_id.
    Binds request_id, user_id, and organization_id to thread-safe contextvars
    for structured logging propagation.
    """
    def process_request(self, request):
        request_id = request.headers.get('X-Request-ID') or str(uuid.uuid4())
        request.request_id = request_id
        
        # Bind request_id early
        set_request_context(request_id=request_id)

    def process_view(self, request, view_func, view_args, view_kwargs):
        # Now that request.user is authenticated and populated, bind user info
        user_id = None
        organization_id = None
        
        if hasattr(request, 'user') and request.user and request.user.is_authenticated:
            user_id = str(request.user.id)
            if getattr(request.user, 'organization_id', None):
                organization_id = str(request.user.organization_id)
                
        set_request_context(
            request_id=getattr(request, 'request_id', None),
            user_id=user_id,
            organization_id=organization_id
        )
        return None

    def process_response(self, request, response):
        if hasattr(request, 'request_id'):
            response['X-Request-ID'] = request.request_id
        # Clear context at end of request lifecycle
        clear_request_context()
        return response

    def process_exception(self, request, exception):
        # Ensure context is cleared even on unhandled view crashes
        clear_request_context()
        return None
