"""
Email Utility Functions
Contains: Email sending utilities with beautiful HTML templates
"""
import logging
import secrets
import string

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from core.utils.threaded_email import send_html_email_async, send_html_email_with_callback

logger = logging.getLogger(__name__)


def _get_panel_login_url(request=None):
    """
    Build the panel login URL for use in emails.
    Automatically appends the panel_entry_token to bypass the gate.
    """
    from django.core.signing import Signer
    from urllib.parse import urlencode

    panel_url = getattr(settings, 'PANEL_URL', '')
    if panel_url:
        base_url = f'{panel_url}/auth/login/'
    elif request:
        base_url = request.build_absolute_uri('/auth/login/')
    else:
        site_url = getattr(settings, 'SITE_URL', 'http://localhost:8000')
        base_url = f'{site_url}/panel/auth/login/'

    signer = Signer(salt='panel-entry-gate')
    token = signer.sign('website-panel-entry')
    qs = urlencode({'panel_entry_token': token})
    return f"{base_url}?{qs}"


def generate_secure_password(length=12):
    """
    Generate a secure random password.
    Contains: uppercase, lowercase, digits, and special characters
    """
    # Ensure at least one of each type
    password = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice('!@#$%&*')
    ]
    
    # Fill the rest with random characters
    alphabet = string.ascii_letters + string.digits + '!@#$%&*'
    password += [secrets.choice(alphabet) for _ in range(length - 4)]
    
    # Shuffle to avoid predictable positions
    secrets.SystemRandom().shuffle(password)
    
    return ''.join(password)


def get_welcome_email_template(name, email, password, role, login_url, phone=''):
    """
    Generate a beautifully designed HTML email for welcome/credentials
    """
    role_display = {
        'admin_staff': 'Admin Staff',
        'client': 'Client',
        'client_staff': 'Client Staff',
    }.get(role, role.replace('_', ' ').title())
    
    # Determine password display: if password equals phone, show mobile-number hint
    if phone and password == phone:
        password_display = 'Your Mobile Number'
        password_hint = '(Use your 10-digit mobile number as password)'
    else:
        password_display = password
        password_hint = '(Please save this password securely)'

    html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; padding: 0; background: #eef2f7; font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; }}
    .mail-shell {{ width: 100%; padding: 24px 12px; background: #eef2f7; }}
    .mail-card {{ width: 100%; max-width: 1200px; min-width: 300px; margin: 0 auto; background: #fff; border: 1px solid #dbe3ef; border-radius: 18px; overflow: hidden; }}
    .mail-header {{ padding: 30px 30px 24px; background: linear-gradient(135deg, #1d4ed8 0%, #4f46e5 100%); color: #fff; }}
    .mail-kicker {{ margin: 0 0 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; opacity: .9; }}
    .mail-title {{ margin: 0; font-size: 28px; line-height: 1.2; font-weight: 700; }}
    .mail-sub {{ margin: 8px 0 0; font-size: 15px; opacity: .95; }}
    .mail-body {{ padding: 28px 30px 24px; }}
    .mail-paragraph {{ margin: 0 0 16px; font-size: 15px; line-height: 1.7; color: #334155; }}
    .cred-box {{ border: 1px solid #dbe4f2; border-left: 4px solid #1d4ed8; border-radius: 14px; background: #f8fbff; padding: 18px; margin: 20px 0; }}
    .cred-title {{ margin: 0 0 14px; font-size: 14px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: .05em; }}
    .cred-row {{ padding: 10px 0; border-top: 1px dashed #cbd5e1; }}
    .cred-row:first-of-type {{ border-top: none; padding-top: 0; }}
    .cred-label {{ margin: 0 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #64748b; }}
    .cred-value {{ margin: 0; font-size: 14px; color: #0f172a; font-weight: 600; word-break: break-word; }}
    .cred-password {{ display: inline-block; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font-family: 'Courier New', monospace; font-size: 14px; }}
    .cred-hint {{ margin: 8px 0 0; font-size: 12px; color: #64748b; }}
    .role-pill {{ display: inline-block; padding: 6px 12px; border-radius: 999px; background: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 700; }}
    .cta-wrap {{ margin: 24px 0; }}
    .cta-btn {{ display: inline-block; padding: 12px 24px; border-radius: 10px; background: #1d4ed8; color: #fff !important; text-decoration: none; font-size: 14px; font-weight: 700; }}
    .help-box {{ margin: 20px 0 0; border: 1px solid #d1fae5; border-left: 4px solid #059669; border-radius: 12px; background: #ecfdf5; padding: 14px 16px; }}
    .help-box h4 {{ margin: 0 0 10px; font-size: 14px; color: #065f46; }}
    .help-box ol {{ margin: 0; padding-left: 18px; color: #065f46; font-size: 13px; line-height: 1.7; }}
    .warn-box {{ margin: 14px 0 0; border: 1px solid #fde68a; border-left: 4px solid #d97706; border-radius: 12px; background: #fffbeb; padding: 12px 14px; font-size: 13px; line-height: 1.6; color: #92400e; }}
    .mail-footer {{ padding: 16px 30px 22px; border-top: 1px solid #e5e7eb; background: #f8fafc; font-size: 12px; color: #64748b; }}
    .mail-footer p {{ margin: 0 0 4px; }}
    @media (max-width: 760px) {{
      .mail-shell {{ padding: 10px 8px; }}
      .mail-card {{ min-width: 300px; border-radius: 14px; }}
      .mail-header {{ padding: 22px 16px 18px; }}
      .mail-title {{ font-size: 22px; }}
      .mail-sub {{ font-size: 13px; }}
      .mail-body {{ padding: 18px 16px 16px; }}
      .mail-footer {{ padding: 14px 16px 18px; }}
    }}
  </style>
</head>
<body>
  <div class="mail-shell">
    <div class="mail-card">
      <div class="mail-header">
        <p class="mail-kicker">Account Activation</p>
        <h1 class="mail-title">Welcome to Adarsh Admin</h1>
        <p class="mail-sub">Your account is ready and credentials are below.</p>
      </div>

      <div class="mail-body">
        <p class="mail-paragraph">Hello <strong>{name}</strong>,</p>
        <p class="mail-paragraph">Your account has been created as <strong>{role_display}</strong>. Please use these credentials to log in and then update your password.</p>

        <div class="cred-box">
          <p class="cred-title">Login Credentials</p>
          <div class="cred-row">
            <p class="cred-label">Email</p>
            <p class="cred-value">{email}</p>
          </div>
          <div class="cred-row">
            <p class="cred-label">Password</p>
            <p class="cred-value"><span class="cred-password">{password_display}</span></p>
            <p class="cred-hint">{password_hint}</p>
          </div>
          <div class="cred-row">
            <p class="cred-label">Role</p>
            <p class="cred-value"><span class="role-pill">{role_display}</span></p>
          </div>
        </div>

        <div class="cta-wrap">
          <a href="{login_url}" class="cta-btn">Login to Panel</a>
        </div>

        <div class="help-box">
          <h4>Password Reset Steps</h4>
          <ol>
            <li>Open the login page and click Forgot Password.</li>
            <li>Enter your email and submit.</li>
            <li>Use the OTP received on email.</li>
            <li>Set a new password and log in again.</li>
          </ol>
        </div>

        <div class="warn-box">
          Security tip: change your password after first login and never share credentials.
        </div>
      </div>

      <div class="mail-footer">
        <p>This is an automated message. Please do not reply.</p>
        <p>Copyright 2026 Adarsh Admin. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>'''
    
    # Plain text fallback
    plain_content = f'''
Welcome to Adarsh Admin!

Hello {name},

Your account has been created as {role_display}.

Your Login Credentials:
------------------------
Email: {email}
Password: {password_display}
Role: {role_display}

Login URL: {login_url}

How to Reset Your Password:
1. Go to the login page and click on "Forgot Password?"
2. Enter your email address and submit
3. You will receive an OTP on your email
4. Enter the OTP and set your new password

Security Tip: We recommend changing your password after first login for better security. Never share your credentials with anyone.

This is an automated message. Please do not reply to this email.

© 2026 Adarsh Admin. All rights reserved.
'''
    
    return html_content, plain_content


def send_welcome_email(name, email, password, role, request=None, phone='', **kwargs):
    """
    Send a welcome email with login credentials to new users.
    
    Args:
        name: User's full name
        email: User's email address
        password: The generated password
        role: User's role (admin_staff, client, client_staff)
        request: Django request object (optional, for building absolute URL)
        phone: User's phone number (to detect phone-as-password)
    
    Returns:
        tuple: (success: bool, message: str)
    """
    try:
        # Skip if email backend is not configured at all
        email_backend = getattr(settings, 'EMAIL_BACKEND', '')
        if not email_backend:
            return False, 'Email backend not configured.'
        # Skip if using console/dummy/filebased backend (not real SMTP)
        _non_smtp_backends = (
            'django.core.mail.backends.console.EmailBackend',
            'django.core.mail.backends.dummy.EmailBackend',
            'django.core.mail.backends.filebased.EmailBackend',
            'django.core.mail.backends.locmem.EmailBackend',
        )
        if email_backend in _non_smtp_backends:
            logger.warning(
                'send_welcome_email: skipped for %s — backend is %s (not SMTP). '
                'Set EMAIL_HOST_USER in .env to enable real email delivery.',
                email, email_backend
            )
            return False, f'Email not sent: backend is {email_backend.split(".")[-1]} (configure SMTP in .env)'
        
        # Build clean login URL (prefers PANEL_URL from settings)
        login_url = _get_panel_login_url(request)
        
        # Get email templates
        html_content, plain_content = get_welcome_email_template(
            name=name,
            email=email,
            password=password,
            role=role,
            login_url=login_url,
            phone=phone
        )
        
        subject = '🎉 Welcome to Adarsh Admin - Your Account is Ready!'
        from_email = settings.DEFAULT_FROM_EMAIL
        to_email = [email]

        # If callbacks provided, send in background thread (non-blocking)
        on_success = kwargs.get('on_success')
        on_failure = kwargs.get('on_failure')
        if on_success or on_failure:
            send_html_email_with_callback(
                subject, plain_content, html_content,
                from_email, to_email,
                on_success=on_success,
                on_failure=on_failure,
                skip_logging=True,
            )
            logger.info("Welcome email queued (async) for %s", email)
            return True, 'Welcome email queued for delivery.'

        # Synchronous fallback (with 30s per-connection timeout)
        # NOTE: We no longer use socket.setdefaulttimeout() because it is
        # process-global and causes race conditions with other threads
        # (background email threads, HTTP requests to FastAPI engine, etc.).
        from django.core.mail import get_connection
        try:
            connection = get_connection(timeout=30)
            msg = EmailMultiAlternatives(
                subject, plain_content, from_email, to_email,
                connection=connection,
            )
            msg.attach_alternative(html_content, "text/html")
            msg.send(fail_silently=False)
            logger.info("Welcome email sent to %s", email)
            return True, 'Welcome email sent successfully!'
        finally:
            pass  # connection auto-closes

    except Exception as e:
        logger.error("Failed to send welcome email to %s: %s", email, e)
        return False, f'Failed to send email: {str(e)}'


def send_password_changed_notification(name, email, request=None):
    """
    Send a notification email informing the user their password was changed by an admin.
    Does NOT include the new password in the email — only a notice.

    Returns:
        bool: True if email was queued successfully, False otherwise.
    """
    try:
        email_backend = getattr(settings, 'EMAIL_BACKEND', '')
        if not email_backend:
            return False

        # Build clean login URL (prefers PANEL_URL from settings)
        login_url = _get_panel_login_url(request)

        html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <style>
        * {{ box-sizing: border-box; }}
        body {{ margin: 0; padding: 0; background: #eef2f7; font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; }}
        .mail-shell {{ width: 100%; padding: 24px 12px; background: #eef2f7; }}
        .mail-card {{ width: 100%; max-width: 1200px; min-width: 300px; margin: 0 auto; background: #fff; border: 1px solid #dbe3ef; border-radius: 18px; overflow: hidden; }}
        .mail-header {{ padding: 28px 30px 22px; background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color: #fff; }}
        .mail-kicker {{ margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; opacity: .9; }}
        .mail-title {{ margin: 0; font-size: 26px; line-height: 1.2; font-weight: 700; }}
        .mail-body {{ padding: 26px 30px 22px; }}
        .mail-text {{ margin: 0 0 14px; font-size: 15px; color: #334155; line-height: 1.7; }}
        .notice {{ margin: 18px 0; padding: 14px 16px; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 12px; background: #fff1f2; color: #9f1239; font-size: 13px; line-height: 1.6; }}
        .cta-btn {{ display: inline-block; margin-top: 8px; padding: 12px 24px; border-radius: 10px; background: #4f46e5; color: #fff !important; text-decoration: none; font-size: 14px; font-weight: 700; }}
        .mail-footer {{ padding: 16px 30px 22px; border-top: 1px solid #e5e7eb; background: #f8fafc; font-size: 12px; color: #64748b; }}
        .mail-footer p {{ margin: 0 0 4px; }}
        @media (max-width: 760px) {{
            .mail-shell {{ padding: 10px 8px; }}
            .mail-card {{ min-width: 300px; border-radius: 14px; }}
            .mail-header {{ padding: 20px 16px 16px; }}
            .mail-title {{ font-size: 21px; }}
            .mail-body {{ padding: 18px 16px 14px; }}
            .mail-footer {{ padding: 14px 16px 18px; }}
        }}
    </style>
</head>
<body>
    <div class="mail-shell">
        <div class="mail-card">
            <div class="mail-header">
                <p class="mail-kicker">Security Notice</p>
                <h1 class="mail-title">Password Updated</h1>
            </div>
            <div class="mail-body">
                <p class="mail-text">Hello <strong>{name}</strong>,</p>
                <p class="mail-text">Your account password was updated by an administrator.</p>
                <p class="mail-text">If this was not requested by you, contact your administrator immediately.</p>
                <div class="notice">For safety, we recommend changing your password after login and keeping it private.</div>
                <a href="{login_url}" class="cta-btn">Login to Panel</a>
            </div>
            <div class="mail-footer">
                <p>This is an automated message. Please do not reply.</p>
                <p>Copyright 2026 Adarsh Admin. All rights reserved.</p>
            </div>
        </div>
    </div>
</body>
</html>'''

        plain_content = (
            f'Hello {name},\n\n'
            f'Your account password has been updated by an administrator.\n'
            f'If you did not request this change, please contact your admin immediately.\n\n'
            f'You can log in at: {login_url}\n\n'
            f'This is an automated message. Please do not reply.'
        )

        subject = '🔒 Your Password Has Been Updated — Adarsh Admin'
        from_email = settings.DEFAULT_FROM_EMAIL
        to_email = [email]

        send_html_email_async(subject, plain_content, html_content, from_email, to_email)
        return True

    except Exception:
        return False


def send_emergency_panel_access_email(target_email, request=None, issued_by=None):
        """
        Send a tokenized panel login link to an existing active account.
        Used by pro users when website entry flow is unavailable.

        Returns:
                tuple: (success: bool, message: str)
        """
        try:
                email = (target_email or '').strip()
                if not email:
                        return False, 'Email is required.'

                from django.contrib.auth import get_user_model

                User = get_user_model()
                target_user = User.objects.filter(email__iexact=email, is_active=True).first()
                if not target_user:
                        return False, 'No active account found for this email.'

                login_url = _get_panel_login_url(request)

                display_name = target_user.get_full_name() or target_user.username or 'User'
                issuer_name = 'System'
                if issued_by is not None:
                        issuer_name = issued_by.get_full_name() or issued_by.username or 'Pro User'

                subject = 'Emergency Panel Access Link - Adarsh Admin'
                from_email = settings.DEFAULT_FROM_EMAIL
                to_email = [target_user.email]

                html_content = f'''<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
    <tr><td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:30px 40px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:22px;">Emergency Access Link</h1>
    </td></tr>
    <tr><td style="padding:32px 40px;">
        <p style="font-size:16px;color:#333;">Hello <strong>{display_name}</strong>,</p>
        <p style="font-size:15px;color:#555;line-height:1.6;">
            A Pro User has shared a secure panel login link for your account. Use this link to open the panel login flow directly.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td align="center">
                <a href="{login_url}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
                    Open Panel Login
                </a>
            </td></tr>
        </table>
        <p style="font-size:13px;color:#666;line-height:1.5;">
            Issued by: <strong>{issuer_name}</strong><br>
            If you did not request this, contact support immediately.
        </p>
        <p style="font-size:12px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:16px;text-align:center;">
            This is an automated message. Please do not reply.
        </p>
    </td></tr>
</table>
</td></tr></table>
</body></html>'''

                plain_content = (
                        f'Hello {display_name},\n\n'
                        f'A Pro User has shared a secure panel login link for your account.\n'
                        f'Use this link: {login_url}\n\n'
                        f'Issued by: {issuer_name}\n\n'
                        f'If you did not request this, contact support immediately.'
                )

                send_html_email_async(subject, plain_content, html_content, from_email, to_email)

                logger.info(
                        'Emergency panel access email queued for %s by %s',
                        target_user.email,
                        issuer_name,
                )
                return True, 'Emergency access link email has been sent.'
        except Exception as e:
                logger.error('Failed to send emergency panel access email to %s: %s', target_email, e)
                return False, 'Failed to send emergency access email.'


def send_not_found_mode_enabled_broadcast(request=None, enabled_by=None):
        """
        Broadcast a notice email to all active users when website not-found mode is enabled.

        Returns:
                tuple: (success: bool, sent_count: int, message: str)
        """
        try:
                from django.contrib.auth import get_user_model

                User = get_user_model()
                recipients = list(
                        User.objects.filter(is_active=True)
                        .exclude(email__isnull=True)
                        .exclude(email__exact='')
                        .values_list('email', flat=True)
                        .distinct()
                )

                if not recipients:
                        return False, 0, 'No active users with email found.'

                login_url = _get_panel_login_url(request)
                actor = 'System'
                if enabled_by is not None:
                        actor = enabled_by.get_full_name() or enabled_by.username or 'Admin'

                subject = 'Website Not Found Mode Enabled - Panel Access Notice'
                from_email = settings.DEFAULT_FROM_EMAIL

                html_content = f'''<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
    <tr><td style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:30px 40px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:22px;">Website Access Mode Updated</h1>
    </td></tr>
    <tr><td style="padding:32px 40px;">
        <p style="font-size:15px;color:#555;line-height:1.7;">
            Public website domain is now in <strong>Not Found Mode</strong>. If you need panel access,
            use the secure panel login link below.
        </p>
        <p style="text-align:center;margin:24px 0;">
            <a href="{login_url}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;">
                Open Panel Login
            </a>
        </p>
        <p style="font-size:12px;color:#666;line-height:1.6;">
            Updated by: <strong>{actor}</strong><br>
            This is an automated notification to all active users.
        </p>
    </td></tr>
</table>
</td></tr></table>
</body></html>'''

                plain_content = (
                        'Website Not Found Mode has been enabled.\n\n'
                        f'Use this panel login link: {login_url}\n\n'
                        f'Updated by: {actor}'
                )

                sent_count = 0
                for email in recipients:
                        send_html_email_async(subject, plain_content, html_content, from_email, [email])
                        sent_count += 1

                logger.info('Not-found mode broadcast queued for %d users', sent_count)
                return True, sent_count, 'Broadcast queued successfully.'
        except Exception as e:
                logger.error('Failed to send not-found mode broadcast: %s', e)
                return False, 0, 'Failed to queue notification emails.'