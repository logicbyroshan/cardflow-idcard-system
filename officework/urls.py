from django.urls import path

from . import views

urlpatterns = [
    path('office-work/', views.office_work_page, name='office_work_page'),
    path('api/office-work/chat/groups/', views.api_office_work_chat_groups_list, name='api_office_work_chat_groups_list'),
    path('api/office-work/chat/groups/create/', views.api_office_work_chat_group_create, name='api_office_work_chat_group_create'),
    path('api/office-work/chat/groups/<int:group_id>/members/update/', views.api_office_work_chat_group_members_update, name='api_office_work_chat_group_members_update'),
    path('api/office-work/chat/', views.api_office_work_chat_list, name='api_office_work_chat_list'),
    path('api/office-work/chat/send/', views.api_office_work_chat_send, name='api_office_work_chat_send'),
    path('api/office-work/chat/message/<int:message_id>/attachment/', views.api_office_work_chat_attachment_download, name='api_office_work_chat_attachment_download'),
    path('api/office-work/tasks/', views.api_office_work_tasks_list, name='api_office_work_tasks_list'),
    path('api/office-work/tasks/create/', views.api_office_work_task_create, name='api_office_work_task_create'),
    path('api/office-work/tasks/<int:task_id>/update/', views.api_office_work_task_update, name='api_office_work_task_update'),
    path('api/office-work/tasks/<int:task_id>/delete/', views.api_office_work_task_delete, name='api_office_work_task_delete'),
    path('api/office-work/tasks/<int:task_id>/comments/', views.api_office_work_task_comments_list, name='api_office_work_task_comments_list'),
    path('api/office-work/tasks/<int:task_id>/comments/create/', views.api_office_work_task_comment_create, name='api_office_work_task_comment_create'),
    path('api/office-work/tasks/comment/<int:comment_id>/attachment/', views.api_office_work_task_comment_attachment_download, name='api_office_work_task_comment_attachment_download'),
]
