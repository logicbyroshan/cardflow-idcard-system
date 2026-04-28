from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
import json

from .models import OfficeWorkLead, OfficeWorkLeadTemplate
from core.services.permission_service import api_require_any_admin

@login_required
@api_require_any_admin
@require_http_methods(["GET"])
def api_office_work_leads_list(request):
    """List all leads for office work."""
    leads = OfficeWorkLead.objects.all().order_by('-created_at')
    data = []
    for lead in leads:
        data.append({
            'id': lead.id,
            'customer_name': lead.customer_name,
            'contact': lead.contact,
            'whatsapp': lead.whatsapp,
            'email': lead.email,
            'location': lead.location,
            'description': lead.description,
            'created_at': lead.created_at.strftime('%Y-%m-%d %H:%M'),
        })
    return JsonResponse({'success': True, 'data': data})

@login_required
@api_require_any_admin
@require_http_methods(["POST"])
def api_office_work_lead_create(request):
    """Create a new lead."""
    try:
        payload = json.loads(request.body)
        lead = OfficeWorkLead.objects.create(
            customer_name=payload.get('customer_name', ''),
            contact=payload.get('contact', ''),
            whatsapp=payload.get('whatsapp', ''),
            email=payload.get('email', ''),
            location=payload.get('location', ''),
            description=payload.get('description', ''),
            created_by=request.user
        )
        return JsonResponse({'success': True, 'message': 'Lead created successfully', 'lead_id': lead.id})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)

@login_required
@api_require_any_admin
@require_http_methods(["POST"])
def api_office_work_lead_update(request, lead_id):
    """Update an existing lead."""
    try:
        lead = get_object_or_404(OfficeWorkLead, id=lead_id)
        payload = json.loads(request.body)
        
        lead.customer_name = payload.get('customer_name', lead.customer_name)
        lead.contact = payload.get('contact', lead.contact)
        lead.whatsapp = payload.get('whatsapp', lead.whatsapp)
        lead.email = payload.get('email', lead.email)
        lead.location = payload.get('location', lead.location)
        lead.description = payload.get('description', lead.description)
        lead.save()
        
        return JsonResponse({'success': True, 'message': 'Lead updated successfully'})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)

@login_required
@api_require_any_admin
@require_http_methods(["POST"])
def api_office_work_lead_delete(request, lead_id):
    """Delete a lead."""
    try:
        lead = get_object_or_404(OfficeWorkLead, id=lead_id)
        lead.delete()
        return JsonResponse({'success': True, 'message': 'Lead deleted successfully'})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)

@login_required
@api_require_any_admin
@require_http_methods(["GET"])
def api_office_work_lead_templates_list(request):
    """List all lead templates."""
    templates = OfficeWorkLeadTemplate.objects.all()
    data = {t.template_type: t.content for t in templates}
    return JsonResponse({'success': True, 'templates': data})

@login_required
@api_require_any_admin
@require_http_methods(["POST"])
def api_office_work_lead_template_save(request):
    """Save or update a lead template."""
    try:
        payload = json.loads(request.body)
        template_type = payload.get('template_type')
        content = payload.get('content', '')
        
        if template_type not in ['whatsapp', 'email']:
            return JsonResponse({'success': False, 'message': 'Invalid template type'}, status=400)
            
        template, created = OfficeWorkLeadTemplate.objects.get_or_create(
            template_type=template_type,
            defaults={'content': content}
        )
        if not created:
            template.content = content
            template.save()
            
        return JsonResponse({'success': True, 'message': f'{template_type.capitalize()} template saved successfully'})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)
