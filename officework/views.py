"""Compatibility export layer for split Office Work views."""

from core.services.realtime_service import publish_topic_event

from .views_chat import (
    api_office_work_chat_attachment_download,
    api_office_work_chat_group_create,
    api_office_work_chat_group_members_update,
    api_office_work_chat_groups_list,
    api_office_work_chat_list,
    api_office_work_chat_send,
    office_work_page,
)
from .views_tasks import (
    api_office_work_task_comment_attachment_download,
    api_office_work_task_comment_create,
    api_office_work_task_comments_list,
    api_office_work_task_create,
    api_office_work_task_delete,
    api_office_work_task_update,
    api_office_work_tasks_list,
)
from .views_leads import (
    api_office_work_leads_list,
    api_office_work_lead_create,
    api_office_work_lead_update,
    api_office_work_lead_delete,
    api_office_work_lead_templates_list,
    api_office_work_lead_template_save,
)

__all__ = [
    'office_work_page',
    'api_office_work_chat_groups_list',
    'api_office_work_chat_group_create',
    'api_office_work_chat_group_members_update',
    'api_office_work_chat_list',
    'api_office_work_chat_send',
    'api_office_work_chat_attachment_download',
    'api_office_work_tasks_list',
    'api_office_work_task_create',
    'api_office_work_task_update',
    'api_office_work_task_delete',
    'api_office_work_task_comments_list',
    'api_office_work_task_comment_create',
    'api_office_work_task_comment_attachment_download',
    'api_office_work_leads_list',
    'api_office_work_lead_create',
    'api_office_work_lead_update',
    'api_office_work_lead_delete',
    'api_office_work_lead_templates_list',
    'api_office_work_lead_template_save',
    'publish_topic_event',
]
