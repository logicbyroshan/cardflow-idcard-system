import json
import os
import sys
import tempfile
import time
from importlib import import_module

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django


django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth import BACKEND_SESSION_KEY, HASH_SESSION_KEY, SESSION_KEY
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = os.getenv('OFFICEWORK_SMOKE_BASE_URL', 'http://127.0.0.1:8010')


def _ensure_user(*, username, email, role, password='pass12345'):
    User = get_user_model()
    user, created = User.objects.get_or_create(
        username=username,
        defaults={
            'email': email,
            'role': role,
            'is_active': True,
        },
    )
    changed = created

    if user.email != email:
        user.email = email
        changed = True
    if user.role != role:
        user.role = role
        changed = True
    if not user.is_active:
        user.is_active = True
        changed = True

    user.set_password(password)
    changed = True

    if changed:
        user.save()
    return user


def _make_session_cookie(user):
    session_engine = import_module(settings.SESSION_ENGINE)
    session = session_engine.SessionStore()
    backend_path = (settings.AUTHENTICATION_BACKENDS or ['django.contrib.auth.backends.ModelBackend'])[0]

    session[SESSION_KEY] = str(user.pk)
    session[BACKEND_SESSION_KEY] = backend_path
    session[HASH_SESSION_KEY] = user.get_session_auth_hash()
    session.save()

    return {
        'name': settings.SESSION_COOKIE_NAME,
        'value': session.session_key,
        'domain': '127.0.0.1',
        'path': '/',
        'httpOnly': True,
        'secure': False,
    }


def _role_context_cookie_map():
    admin = _ensure_user(
        username='smoke_admin_staff',
        email='smoke_admin_staff@example.com',
        role='admin_staff',
    )
    client = _ensure_user(
        username='smoke_client_role',
        email='smoke_client_role@example.com',
        role='client',
    )
    assistant = _ensure_user(
        username='smoke_assistant_role',
        email='smoke_assistant_role@example.com',
        role='client_staff',
    )

    return {
        'admin': _make_session_cookie(admin),
        'client': _make_session_cookie(client),
        'assistant': _make_session_cookie(assistant),
    }


def _admin_officework_checks(browser, cookie):
    context = browser.new_context(base_url=BASE_URL)
    context.add_cookies([cookie])
    page = context.new_page()

    js_errors = []
    js_warnings = []
    api_trace = []

    page.on('pageerror', lambda exc: js_errors.append(str(exc)))
    page.on('console', lambda msg: js_errors.append(msg.text) if msg.type == 'error' else js_warnings.append(msg.text) if msg.type == 'warning' else None)
    page.on('response', lambda resp: api_trace.append({'url': resp.url, 'status': resp.status}) if 'office-work/chat' in resp.url else None)

    result = {
        'role': 'admin',
        'page_ok': False,
        'groups_loaded': False,
        'chat_send_ok': False,
        'attachment_send_ok': False,
        'tasks_tab_ok': False,
        'task_card_create_ok': False,
        'task_drag_move_ok': False,
        'task_drag_fallback_used': False,
        'share_tab_ok': False,
        'realtime_connected': False,
        'final_url': '',
        'api_client_type': '',
        'config_chat_groups_url': '',
        'js_errors': js_errors,
        'js_warnings': js_warnings,
        'api_trace': api_trace,
    }

    response = page.goto('/panel/office-work/', wait_until='networkidle')
    result['final_url'] = page.url
    result['api_client_type'] = page.evaluate("() => typeof window.ApiClient")
    result['config_chat_groups_url'] = page.evaluate("() => ((window.OfficeWorkConfig || {}).endpoints || {}).chatGroupsList || ''")
    status_ok = response is not None and response.status == 200

    if status_ok and '/panel/office-work/' in page.url and page.locator('#officeChatInput').count() == 1:
        result['page_ok'] = True

    if not result['page_ok']:
        context.close()
        return result

    try:
        page.wait_for_function(
            "() => { const sel = document.querySelector('#officeChatGroupSelect'); return !!sel && sel.options.length > 0; }",
            timeout=15000,
        )
        group_count = page.locator('#officeChatGroupSelect option').count()
        result['groups_loaded'] = group_count > 0
        result['realtime_connected'] = bool(page.evaluate("() => !!(window.AppRealtimeService && window.AppRealtimeService.isConnected && window.AppRealtimeService.isConnected())"))
    except PlaywrightTimeoutError:
        result['groups_loaded'] = False
        context.close()
        return result

    message_text = 'Browser smoke message ' + str(int(time.time()))
    page.fill('#officeChatInput', message_text)
    page.click('#officeChatForm button[type="submit"]')
    try:
        page.wait_for_function(
            "msg => Array.from(document.querySelectorAll('#officeChatList .client-message-text')).some((el) => (el.textContent || '').indexOf(msg) !== -1)",
            arg=message_text,
            timeout=5000,
        )
        result['chat_send_ok'] = True
    except PlaywrightTimeoutError:
        active_group_id = page.evaluate("() => Number((document.querySelector('#officeChatGroupSelect') || {}).value || 0)")
        if active_group_id > 0:
            fallback_response = page.request.get('/panel/api/office-work/chat/?limit=50&group_id=' + str(active_group_id))
            if fallback_response.ok:
                payload = fallback_response.json()
                messages = payload.get('messages') if isinstance(payload, dict) else []
                result['chat_send_ok'] = any(str(item.get('message') or '') == message_text for item in (messages or []))
            else:
                result['chat_send_ok'] = False
        else:
            result['chat_send_ok'] = False

    fd, path = tempfile.mkstemp(prefix='officework-smoke-', suffix='.txt')
    os.close(fd)
    file_name = os.path.basename(path)
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write('Playwright browser smoke attachment')

    try:
        page.set_input_files('#officeChatFileInput', path)
        page.click('#officeChatForm button[type="submit"]')
        page.wait_for_timeout(1800)
        result['attachment_send_ok'] = page.locator('#officeChatList .office-chat-file-link', has_text=file_name).count() > 0
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

    page.click('.office-tab-btn[data-tab="tasks"]')
    page.wait_for_timeout(400)
    result['tasks_tab_ok'] = page.locator('#officeTaskForm').is_visible()

    if result['tasks_tab_ok']:
        task_title = 'Smoke Kanban Task ' + str(int(time.time()))
        page.fill('#officeTaskTitle', task_title)
        page.fill('#officeTaskDescription', 'Created during browser smoke test')
        page.click('#officeTaskSubmitBtn')

        try:
            page.wait_for_function(
                "title => Array.from(document.querySelectorAll('[data-list-for=\"todo\"] .office-task-card-title')).some((el) => (el.textContent || '').indexOf(title) !== -1)",
                arg=task_title,
                timeout=7000,
            )
            result['task_card_create_ok'] = True
        except PlaywrightTimeoutError:
            result['task_card_create_ok'] = False

        if result['task_card_create_ok']:
            card_locator = page.locator('.office-task-card', has_text=task_title).first
            try:
                card_locator.drag_to(page.locator('[data-list-for="in_progress"]'))
                page.wait_for_function(
                    "title => Array.from(document.querySelectorAll('[data-list-for=\"in_progress\"] .office-task-card-title')).some((el) => (el.textContent || '').indexOf(title) !== -1)",
                    arg=task_title,
                    timeout=7000,
                )
                result['task_drag_move_ok'] = True
            except PlaywrightTimeoutError:
                task_id = page.evaluate(
                    """
                    title => {
                        const cards = Array.from(document.querySelectorAll('.office-task-card[data-task-id]'));
                        const match = cards.find((card) => (card.textContent || '').indexOf(title) !== -1);
                        return match ? Number(match.getAttribute('data-task-id') || 0) : 0;
                    }
                    """,
                    task_title,
                )

                if task_id > 0:
                    update_ok = page.evaluate(
                        """
                        async payload => {
                            if (!window.ApiClient || typeof window.ApiClient.post !== 'function') {
                                return false;
                            }
                            try {
                                const path = '/panel/api/office-work/tasks/' + encodeURIComponent(String(payload.taskId || '')) + '/update/';
                                const data = await window.ApiClient.post(path, { status: 'in_progress' });
                                return !!(data && data.success);
                            } catch (err) {
                                return false;
                            }
                        }
                        """,
                        {'taskId': task_id},
                    )
                    if update_ok:
                        try:
                            page.wait_for_function(
                                "title => Array.from(document.querySelectorAll('[data-list-for=\"in_progress\"] .office-task-card-title')).some((el) => (el.textContent || '').indexOf(title) !== -1)",
                                arg=task_title,
                                timeout=7000,
                            )
                            result['task_drag_move_ok'] = True
                            result['task_drag_fallback_used'] = True
                        except PlaywrightTimeoutError:
                            result['task_drag_move_ok'] = False
                else:
                    result['task_drag_move_ok'] = False

    page.click('.office-tab-btn[data-tab="share"]')
    page.wait_for_timeout(400)
    result['share_tab_ok'] = page.locator('#officeShareForm').is_visible()

    context.close()
    return result


def _blocked_role_checks(browser, *, role, cookie):
    context = browser.new_context(base_url=BASE_URL)
    context.add_cookies([cookie])
    page = context.new_page()

    response = page.goto('/panel/office-work/', wait_until='networkidle')
    status = response.status if response is not None else None
    final_url = page.url

    api_response = page.goto('/panel/api/office-work/chat/groups/', wait_until='networkidle')
    api_status = api_response.status if api_response is not None else None
    api_final_url = page.url

    context.close()

    denied_page = '/panel/office-work/' not in final_url
    denied_api = '/panel/api/office-work/chat/groups/' not in api_final_url

    return {
        'role': role,
        'office_page_status': status,
        'office_page_url': final_url,
        'groups_api_status': api_status,
        'groups_api_url': api_final_url,
        'blocked_page': denied_page,
        'blocked_api': denied_api,
    }


def main():
    cookie_map = _role_context_cookie_map()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        admin_result = _admin_officework_checks(browser, cookie_map['admin'])
        client_result = _blocked_role_checks(browser, role='client', cookie=cookie_map['client'])
        assistant_result = _blocked_role_checks(browser, role='assistant', cookie=cookie_map['assistant'])
        browser.close()

    summary = {
        'base_url': BASE_URL,
        'admin': admin_result,
        'client': client_result,
        'assistant': assistant_result,
    }

    checks = [
        admin_result['page_ok'],
        admin_result['groups_loaded'],
        admin_result['chat_send_ok'],
        admin_result['attachment_send_ok'],
        admin_result['tasks_tab_ok'],
        admin_result['task_card_create_ok'],
        admin_result['task_drag_move_ok'],
        admin_result['share_tab_ok'],
        client_result['blocked_page'],
        client_result['blocked_api'],
        assistant_result['blocked_page'],
        assistant_result['blocked_api'],
    ]

    print(json.dumps(summary, indent=2))
    if not all(checks):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
