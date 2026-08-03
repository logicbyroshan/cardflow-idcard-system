"""
HTMX Utilities — helpers for detecting HTMX requests and rendering partials.

Usage in views:
    from core.utils.htmx import is_htmx, render_partial

    def my_view(request):
        context = { ... }
        return render_partial(request, 'my-page.html', 'partials/my-table.html', context)
"""
from django.shortcuts import render
from django.http import HttpResponse


def is_htmx(request):
    """Return True if the request was made by HTMX."""
    return request.headers.get('HX-Request') == 'true'


def render_partial(request, full_template, partial_template, context):
    """
    If the request is an HTMX request, render only the partial template.
    Otherwise, render the full page template.
    """
    template = partial_template if is_htmx(request) else full_template
    return render(request, template, context)


def htmx_trigger(response, event_name, detail=None):
    """
    Add an HX-Trigger header to a response so HTMX can react to server events.

    Usage:
        resp = render(request, 'partial.html', ctx)
        return htmx_trigger(resp, 'refreshTable')

    With detail:
        return htmx_trigger(resp, 'showToast', {'message': 'Saved!', 'type': 'success'})
    """
    import json
    if detail:
        response['HX-Trigger'] = json.dumps({event_name: detail})
    else:
        response['HX-Trigger'] = event_name
    return response


def htmx_redirect(url):
    """
    Return an empty 200 response with HX-Redirect header.
    HTMX will perform a full client-side redirect to the given URL.
    """
    response = HttpResponse(status=200)
    response['HX-Redirect'] = url
    return response


def htmx_refresh():
    """
    Return an empty 200 response with HX-Refresh: true.
    HTMX will perform a full page refresh.
    """
    response = HttpResponse(status=200)
    response['HX-Refresh'] = 'true'
    return response
