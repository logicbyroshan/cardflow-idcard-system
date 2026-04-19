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
from .views_share import (
    api_office_work_share_delete,
    api_office_work_share_download,
    api_office_work_share_list,
    api_office_work_share_upload,
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
    'api_office_work_share_list',
    'api_office_work_share_upload',
    'api_office_work_share_download',
    'api_office_work_share_delete',
    'publish_topic_event',
]
