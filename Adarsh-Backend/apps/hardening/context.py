import contextvars

_request_id = contextvars.ContextVar('request_id', default=None)
_user_id = contextvars.ContextVar('user_id', default=None)
_organization_id = contextvars.ContextVar('organization_id', default=None)

def set_request_context(request_id=None, user_id=None, organization_id=None):
    if request_id is not None:
        _request_id.set(request_id)
    if user_id is not None:
        _user_id.set(user_id)
    if organization_id is not None:
        _organization_id.set(organization_id)

def get_request_id():
    return _request_id.get()

def get_user_id():
    return _user_id.get()

def get_organization_id():
    return _organization_id.get()

def get_request_context() -> dict:
    return {
        'request_id': _request_id.get(),
        'user_id': _user_id.get(),
        'organization_id': _organization_id.get(),
    }

def clear_request_context():
    _request_id.set(None)
    _user_id.set(None)
    _organization_id.set(None)
