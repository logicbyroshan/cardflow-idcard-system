import json
import os
import sys
import time
from importlib import import_module

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django


django.setup()

from django.conf import settings
from django.contrib.auth import BACKEND_SESSION_KEY, HASH_SESSION_KEY, SESSION_KEY
from django.contrib.auth import get_user_model
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = os.getenv('OFFICEWORK_SMOKE_BASE_URL', 'http://127.0.0.1:8010')


def _ensure_admin_user(*, username, email, password='pass12345'):
    User = get_user_model()
    user, created = User.objects.get_or_create(
        username=username,
        defaults={
            'email': email,
            'role': 'admin_staff',
            'is_active': True,
            'is_staff': True,
        },
    )

    changed = created
    if user.email != email:
        user.email = email
        changed = True
    if user.role != 'admin_staff':
        user.role = 'admin_staff'
        changed = True
    if not user.is_active:
        user.is_active = True
        changed = True
    if not user.is_staff:
        user.is_staff = True
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


def _open_officework_page(browser, *, cookie):
    context = browser.new_context(base_url=BASE_URL)
    context.add_cookies([cookie])
    page = context.new_page()

    js_errors = []
    js_warnings = []
    page.on('pageerror', lambda exc: js_errors.append(str(exc)))
    page.on('console', lambda msg: js_errors.append(msg.text) if msg.type == 'error' else js_warnings.append(msg.text) if msg.type == 'warning' else None)

    response = page.goto('/panel/office-work/', wait_until='networkidle')
    status_ok = response is not None and response.status == 200

    if not status_ok:
        raise RuntimeError('Failed to open office-work page.')

    page.wait_for_function(
        """
        () => {
            const sel = document.querySelector('#officeChatGroupSelect');
            const input = document.querySelector('#officeChatInput');
            return !!sel && sel.options.length > 0 && !!input;
        }
        """,
        timeout=15000,
    )

    page.wait_for_function(
        """
        () => !!(window.AppRealtimeService && window.AppRealtimeService.isConnected && window.AppRealtimeService.isConnected())
        """,
        timeout=15000,
    )

    return context, page, js_errors, js_warnings


def main():
    user_a = _ensure_admin_user(username='smoke_multi_admin_a', email='smoke_multi_admin_a@example.com')
    user_b = _ensure_admin_user(username='smoke_multi_admin_b', email='smoke_multi_admin_b@example.com')

    cookie_a = _make_session_cookie(user_a)
    cookie_b = _make_session_cookie(user_b)

    result = {
        'base_url': BASE_URL,
        'group_id_a': '',
        'group_id_b': '',
        'chat_realtime_cross_user_ok': False,
        'task_create_cross_user_ok': False,
        'task_drag_cross_user_ok': False,
        'js_errors_a': [],
        'js_errors_b': [],
        'js_warnings_a': [],
        'js_warnings_b': [],
        'realtime_topics_a': [],
        'realtime_topics_b': [],
        'realtime_packets_a': [],
        'realtime_packets_b': [],
        'chat_dom_tail_b': [],
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context_a = None
        context_b = None
        try:
            context_a, page_a, js_errors_a, js_warnings_a = _open_officework_page(browser, cookie=cookie_a)
            context_b, page_b, js_errors_b, js_warnings_b = _open_officework_page(browser, cookie=cookie_b)

            result['js_errors_a'] = js_errors_a
            result['js_errors_b'] = js_errors_b
            result['js_warnings_a'] = js_warnings_a
            result['js_warnings_b'] = js_warnings_b

            page_a.evaluate(
                """
                () => {
                    window.__owRealtimePackets = [];
                    if (window.AppRealtimeService && typeof window.AppRealtimeService.onMessage === 'function') {
                        window.AppRealtimeService.onMessage((packet) => {
                            try {
                                window.__owRealtimePackets.push({
                                    type: packet && packet.type,
                                    topic: packet && packet.topic,
                                    event: packet && packet.event,
                                    status: packet && packet.status,
                                    payload_group_id: packet && packet.payload && packet.payload.item ? packet.payload.item.group_id : null,
                                });
                                if (window.__owRealtimePackets.length > 60) {
                                    window.__owRealtimePackets.shift();
                                }
                            } catch (err) {
                                // ignore packet inspection errors in smoke diagnostics
                            }
                        });
                    }
                }
                """
            )
            page_b.evaluate(
                """
                () => {
                    window.__owRealtimePackets = [];
                    if (window.AppRealtimeService && typeof window.AppRealtimeService.onMessage === 'function') {
                        window.AppRealtimeService.onMessage((packet) => {
                            try {
                                window.__owRealtimePackets.push({
                                    type: packet && packet.type,
                                    topic: packet && packet.topic,
                                    event: packet && packet.event,
                                    status: packet && packet.status,
                                    payload_group_id: packet && packet.payload && packet.payload.item ? packet.payload.item.group_id : null,
                                });
                                if (window.__owRealtimePackets.length > 60) {
                                    window.__owRealtimePackets.shift();
                                }
                            } catch (err) {
                                // ignore packet inspection errors in smoke diagnostics
                            }
                        });
                    }
                }
                """
            )

            # Keep both sessions on the same chat group before cross-user assertions.
            selected_group = page_a.eval_on_selector('#officeChatGroupSelect', 'el => String(el.value || "")')
            if not selected_group:
                selected_group = page_a.eval_on_selector('#officeChatGroupSelect option:first-child', 'el => String((el && el.value) || "")')
            if not selected_group:
                raise RuntimeError('No chat group available for multi-user test.')

            page_a.evaluate(
                """
                value => {
                    const sel = document.querySelector('#officeChatGroupSelect');
                    if (!sel) {
                        return;
                    }
                    sel.value = String(value || '');
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }
                """,
                selected_group,
            )
            page_b.evaluate(
                """
                value => {
                    const sel = document.querySelector('#officeChatGroupSelect');
                    if (!sel) {
                        return;
                    }
                    sel.value = String(value || '');
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }
                """,
                selected_group,
            )
            page_a.wait_for_timeout(400)
            page_b.wait_for_timeout(400)

            result['group_id_a'] = page_a.eval_on_selector('#officeChatGroupSelect', 'el => String(el.value || "")')
            result['group_id_b'] = page_b.eval_on_selector('#officeChatGroupSelect', 'el => String(el.value || "")')
            result['realtime_topics_a'] = page_a.evaluate(
                """
                () => {
                    if (!window.AppRealtimeService) {
                        return [];
                    }
                    return Array.from(window.AppRealtimeService.desiredTopics || []);
                }
                """
            )
            result['realtime_topics_b'] = page_b.evaluate(
                """
                () => {
                    if (!window.AppRealtimeService) {
                        return [];
                    }
                    return Array.from(window.AppRealtimeService.desiredTopics || []);
                }
                """
            )

            # Chat realtime cross-user check
            msg = 'Multi-user realtime chat ' + str(int(time.time()))
            chat_create_ok = page_a.evaluate(
                """
                payload => {
                    if (!window.ApiClient || typeof window.ApiClient.post !== 'function') {
                        return false;
                    }
                    return window.ApiClient.post('/panel/api/office-work/chat/send/', payload)
                        .then((data) => !!(data && data.success))
                        .catch(() => false);
                }
                """,
                {
                    'message': msg,
                    'group_id': int(selected_group),
                },
            )
            if not chat_create_ok:
                raise RuntimeError('Failed creating chat message for multi-user check.')

            try:
                page_b.wait_for_function(
                    """
                    text => Array.from(document.querySelectorAll('#officeChatList .client-message-text')).some((el) => (el.textContent || '').indexOf(text) !== -1)
                    """,
                    arg=msg,
                    timeout=14000,
                )
                result['chat_realtime_cross_user_ok'] = True
            except PlaywrightTimeoutError:
                result['chat_realtime_cross_user_ok'] = False

            result['realtime_packets_a'] = page_a.evaluate('() => Array.isArray(window.__owRealtimePackets) ? window.__owRealtimePackets.slice(-20) : []')
            result['realtime_packets_b'] = page_b.evaluate('() => Array.isArray(window.__owRealtimePackets) ? window.__owRealtimePackets.slice(-20) : []')
            result['chat_dom_tail_b'] = page_b.evaluate(
                """
                () => Array.from(document.querySelectorAll('#officeChatList .client-message-text'))
                    .map((el) => (el.textContent || '').trim())
                    .filter(Boolean)
                    .slice(-8)
                """
            )

            # Open tasks tab in both sessions
            page_a.click('.office-tab-btn[data-tab="tasks"]')
            page_b.click('.office-tab-btn[data-tab="tasks"]')
            page_a.wait_for_timeout(350)
            page_b.wait_for_timeout(350)

            task_title = 'Multi-user realtime task ' + str(int(time.time()))
            page_a.fill('#officeTaskTitle', task_title)
            page_a.fill('#officeTaskDescription', 'Created in session A and observed in B')
            page_a.click('#officeTaskSubmitBtn')

            try:
                page_b.wait_for_function(
                    """
                    title => Array.from(document.querySelectorAll('[data-list-for="todo"] .office-task-card-title')).some((el) => (el.textContent || '').indexOf(title) !== -1)
                    """,
                    arg=task_title,
                    timeout=10000,
                )
                result['task_create_cross_user_ok'] = True
            except PlaywrightTimeoutError:
                result['task_create_cross_user_ok'] = False

            if result['task_create_cross_user_ok']:
                task_id = page_b.evaluate(
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
                    update_ok = page_b.evaluate(
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
                    if not update_ok:
                        raise RuntimeError('Failed updating task status for multi-user check.')

                    try:
                        page_a.wait_for_function(
                            """
                            title => Array.from(document.querySelectorAll('[data-list-for=\"in_progress\"] .office-task-card-title')).some((el) => (el.textContent || '').indexOf(title) !== -1)
                            """,
                            arg=task_title,
                            timeout=10000,
                        )
                        result['task_drag_cross_user_ok'] = True
                    except PlaywrightTimeoutError:
                        result['task_drag_cross_user_ok'] = False

        finally:
            if context_a is not None:
                context_a.close()
            if context_b is not None:
                context_b.close()
            browser.close()

    print(json.dumps(result, indent=2))

    checks = [
        result['chat_realtime_cross_user_ok'],
        result['task_create_cross_user_ok'],
        result['task_drag_cross_user_ok'],
        not result['js_errors_a'],
        not result['js_errors_b'],
    ]
    if not all(checks):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
