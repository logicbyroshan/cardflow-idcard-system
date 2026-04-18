from django.urls import path

from . import views

urlpatterns = [
    path('office-work/', views.office_work_page, name='office_work_page'),
    path('api/office-work/chat/', views.api_office_work_chat_list, name='api_office_work_chat_list'),
    path('api/office-work/chat/send/', views.api_office_work_chat_send, name='api_office_work_chat_send'),
    path('api/office-work/tasks/', views.api_office_work_tasks_list, name='api_office_work_tasks_list'),
    path('api/office-work/tasks/create/', views.api_office_work_task_create, name='api_office_work_task_create'),
    path('api/office-work/tasks/<int:task_id>/update/', views.api_office_work_task_update, name='api_office_work_task_update'),
    path('api/office-work/tasks/<int:task_id>/delete/', views.api_office_work_task_delete, name='api_office_work_task_delete'),
    path('api/office-work/share/', views.api_office_work_share_list, name='api_office_work_share_list'),
    path('api/office-work/share/upload/', views.api_office_work_share_upload, name='api_office_work_share_upload'),
    path('api/office-work/share/<int:file_id>/download/', views.api_office_work_share_download, name='api_office_work_share_download'),
    path('api/office-work/share/<int:file_id>/delete/', views.api_office_work_share_delete, name='api_office_work_share_delete'),
]
