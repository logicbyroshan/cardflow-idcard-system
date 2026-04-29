from django.urls import path

from . import views

urlpatterns = [
    path('office-work/', views.office_work_page, name='office_work_page'),

    path('api/office-work/tasks/', views.api_office_work_tasks_list, name='api_office_work_tasks_list'),
    path('api/office-work/tasks/create/', views.api_office_work_task_create, name='api_office_work_task_create'),
    path('api/office-work/tasks/<int:task_id>/update/', views.api_office_work_task_update, name='api_office_work_task_update'),
    path('api/office-work/tasks/<int:task_id>/delete/', views.api_office_work_task_delete, name='api_office_work_task_delete'),
    path('api/office-work/tasks/<int:task_id>/comments/', views.api_office_work_task_comments_list, name='api_office_work_task_comments_list'),
    path('api/office-work/tasks/<int:task_id>/comments/create/', views.api_office_work_task_comment_create, name='api_office_work_task_comment_create'),
    path('api/office-work/tasks/comment/<int:comment_id>/attachment/', views.api_office_work_task_comment_attachment_download, name='api_office_work_task_comment_attachment_download'),
    
    path('api/office-work/leads/', views.api_office_work_leads_list, name='api_office_work_leads_list'),
    path('api/office-work/leads/create/', views.api_office_work_lead_create, name='api_office_work_lead_create'),
    path('api/office-work/leads/<int:lead_id>/update/', views.api_office_work_lead_update, name='api_office_work_lead_update'),
    path('api/office-work/leads/<int:lead_id>/delete/', views.api_office_work_lead_delete, name='api_office_work_lead_delete'),
    
    path('api/office-work/leads/templates/', views.api_office_work_lead_templates_list, name='api_office_work_lead_templates_list'),
    path('api/office-work/leads/templates/save/', views.api_office_work_lead_template_save, name='api_office_work_lead_template_save'),
]
