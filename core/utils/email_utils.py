"""
Email Utility Functions
Contains: Email sending utilities with beautiful HTML templates
"""
import logging
import secrets
import string
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from core.utils.threaded_email import send_html_email_async, send_html_email_with_callback

logger = logging.getLogger(__name__)


def _get_panel_login_url(request=None):
    """
    Build the panel login URL for use in emails.
    Automatically appends the panel_entry_token to bypass the gate.
    """
    from django.core.signing import TimestampSigner
    from urllib.parse import urlencode

    panel_url = getattr(settings, 'PANEL_URL', '')
    if panel_url:
        base_url = f'{panel_url}/auth/login/'
    elif request:
        base_url = request.build_absolute_uri('/auth/login/')
    else:
        site_url = getattr(settings, 'SITE_URL', 'http://localhost:8000')
        base_url = f'{site_url}/panel/auth/login/'

    signer = TimestampSigner(salt='panel-entry-gate')
    token = signer.sign('website-panel-entry')
    qs = urlencode({'panel_entry_token': token})
    return f"{base_url}?{qs}"


EMAIL_THEME_TOKENS = {
        'welcome': {
                'header_gradient': 'linear-gradient(135deg,#2563eb 0%,#4338ca 100%)',
                'accent': '#2563eb',
                'badge_bg': '#dbeafe',
                'badge_text': '#1e3a8a',
                'info_bg': '#eff6ff',
                'info_border': '#bfdbfe',
        },
        'temp_password': {
                'header_gradient': 'linear-gradient(135deg,#ea580c 0%,#d97706 100%)',
                'accent': '#ea580c',
                'badge_bg': '#ffedd5',
                'badge_text': '#9a3412',
                'info_bg': '#fff7ed',
                'info_border': '#fed7aa',
        },
        'password_change': {
                'header_gradient': 'linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%)',
                'accent': '#7c3aed',
                'badge_bg': '#ede9fe',
                'badge_text': '#5b21b6',
                'info_bg': '#f5f3ff',
                'info_border': '#ddd6fe',
        },
        'otp': {
                'header_gradient': 'linear-gradient(135deg,#0f766e 0%,#0e7490 100%)',
                'accent': '#0f766e',
                'badge_bg': '#ccfbf1',
                'badge_text': '#115e59',
                'info_bg': '#f0fdfa',
                'info_border': '#99f6e4',
        },
        'security_alert': {
                'header_gradient': 'linear-gradient(135deg,#dc2626 0%,#b91c1c 100%)',
                'accent': '#dc2626',
                'badge_bg': '#fee2e2',
                'badge_text': '#991b1b',
                'info_bg': '#fef2f2',
                'info_border': '#fecaca',
        },
        'system': {
                'header_gradient': 'linear-gradient(135deg,#334155 0%,#1e293b 100%)',
                'accent': '#334155',
                'badge_bg': '#e2e8f0',
                'badge_text': '#334155',
                'info_bg': '#f8fafc',
                'info_border': '#cbd5e1',
        },
        'contact': {
                'header_gradient': 'linear-gradient(135deg,#0d9488 0%,#0f766e 100%)',
                'accent': '#0d9488',
                'badge_bg': '#ccfbf1',
                'badge_text': '#134e4a',
                'info_bg': '#f0fdfa',
                'info_border': '#99f6e4',
        },
        'general': {
                'header_gradient': 'linear-gradient(135deg,#2563eb 0%,#4338ca 100%)',
                'accent': '#2563eb',
                'badge_bg': '#dbeafe',
                'badge_text': '#1e3a8a',
                'info_bg': '#eff6ff',
                'info_border': '#bfdbfe',
        },
        'announcement': {
                'header_gradient': 'linear-gradient(135deg,#d97706 0%,#b45309 100%)',
                'accent': '#d97706',
                'badge_bg': '#fef3c7',
                'badge_text': '#92400e',
                'info_bg': '#fffbeb',
                'info_border': '#fde68a',
        },
        'update': {
                'header_gradient': 'linear-gradient(135deg,#059669 0%,#0f766e 100%)',
                'accent': '#059669',
                'badge_bg': '#d1fae5',
                'badge_text': '#065f46',
                'info_bg': '#ecfdf5',
                'info_border': '#a7f3d0',
        },
        'maintenance': {
                'header_gradient': 'linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%)',
                'accent': '#7c3aed',
                'badge_bg': '#ede9fe',
                'badge_text': '#5b21b6',
                'info_bg': '#f5f3ff',
                'info_border': '#ddd6fe',
        },
        'alert': {
                'header_gradient': 'linear-gradient(135deg,#dc2626 0%,#b91c1c 100%)',
                'accent': '#dc2626',
                'badge_bg': '#fee2e2',
                'badge_text': '#991b1b',
                'info_bg': '#fef2f2',
                'info_border': '#fecaca',
        },
}


def _resolve_site_base_url(request=None):
        """Return the best public website base URL for absolute links in emails."""
        configured = (
                getattr(settings, 'WEBSITE_URL', '')
                or getattr(settings, 'SITE_URL', '')
                or ''
        ).rstrip('/')
        if configured:
                return configured
        if request is not None:
                try:
                        return request.build_absolute_uri('/').rstrip('/')
                except Exception:
                        pass
        return 'http://localhost:8000'


def _absolute_url(url, request=None):
        """Convert relative media paths to absolute URLs for email clients."""
        value = (url or '').strip()
        if not value:
                return ''
        if value.startswith('http://') or value.startswith('https://'):
                return value
        if not value.startswith('/'):
                value = f'/{value}'
        return f"{_resolve_site_base_url(request)}{value}"


def get_email_product_showcase(request=None, limit=5):
        """Fetch top portfolio products for the shared email footer showcase."""
        try:
                from website.models import PortfolioItem

                products = (
                        PortfolioItem.objects
                        .filter(is_active=True, image__isnull=False)
                        .exclude(image='')
                        .order_by('-is_featured', 'order', '-created_at')[:limit]
                )
                items = []
                for product in products:
                        image_url = _absolute_url(product.image.url if product.image else '', request=request)
                        if not image_url:
                                continue
                        items.append({
                                'title': product.title,
                                'category': product.category.name if product.category else 'Product',
                                'image_url': image_url,
                        })
                return items
        except Exception:
                return []


def build_unified_email_html(
        *,
        theme='system',
        kicker='Adarsh Admin',
        title='Notification',
        subtitle='',
        body_html='',
        cta_label='',
        cta_url='',
        badge_text='',
        request=None,
        showcase_items=None,
):
                """Build a modern, consistent email shell with theme accents and product showcase."""
                tokens = EMAIL_THEME_TOKENS.get(theme, EMAIL_THEME_TOKENS['system'])
                items = showcase_items if showcase_items is not None else get_email_product_showcase(request=request, limit=5)
                website_url = _resolve_site_base_url(request)
                safe_cta_url = escape(cta_url, quote=True)

                showcase_html = ''
                if items:
                                cells = []
                                for item in items[:5]:
                                                item_title = escape(item.get('title') or 'Product')
                                                item_category = escape(item.get('category') or 'Product')
                                                item_image = escape(item.get('image_url') or '', quote=True)
                                                cells.append(
                                                                f"""
                                                                <td style="padding:6px;vertical-align:top;">
                                                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff;">
                                                                                <tr>
                                                                                        <td style="padding:0;"><img src="{item_image}" alt="{item_title}" style="display:block;width:100%;height:92px;object-fit:cover;"></td>
                                                                                </tr>
                                                                                <tr>
                                                                                        <td style="padding:8px 8px 10px;">
                                                                                                <div style="font-size:11px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{item_title}</div>
                                                                                                <div style="font-size:10px;color:#64748b;margin-top:2px;">{item_category}</div>
                                                                                        </td>
                                                                                </tr>
                                                                        </table>
                                                                </td>
                                                                """
                                                )

                                showcase_html = f"""
                                <tr>
                                        <td style="padding:4px 24px 18px;">
                                                <div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#475569;margin-bottom:8px;">Product Showcase</div>
                                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="showcase-grid">
                                                        <tr>{''.join(cells)}</tr>
                                                </table>
                                        </td>
                                </tr>
                                """

                cta_html = ''
                if cta_label and cta_url:
                                cta_html = (
                                                f"<p style=\"margin:20px 0 8px;\">"
                                                f"<a href=\"{safe_cta_url}\" style=\"display:inline-block;padding:12px 22px;border-radius:10px;"
                                                f"background:{tokens['accent']};color:#ffffff !important;text-decoration:none;font-size:14px;font-weight:700;\">"
                                                f"{escape(cta_label)}</a></p>"
                                )

                badge_html = ''
                if badge_text:
                                badge_html = (
                                                f"<span style=\"display:inline-block;padding:6px 12px;border-radius:999px;"
                                                f"background:{tokens['badge_bg']};color:{tokens['badge_text']};font-size:12px;font-weight:700;\">"
                                                f"{escape(badge_text)}</span>"
                                )

                subtitle_html = ''
                if subtitle:
                                subtitle_html = (
                                                '<div style="margin-top:8px;font-size:14px;line-height:1.55;color:rgba(255,255,255,.92);">'
                                                f'{escape(subtitle)}'
                                                '</div>'
                                )

                return f"""<!DOCTYPE html>
<html lang="en">
<head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1.0">
        <meta name="color-scheme" content="light only">
        <meta name="supported-color-schemes" content="light only">
        <style>
                body {{ margin:0; padding:0; background:#eef2f7; color:#0f172a; font-family:'Saira Semi Condensed','Segoe UI',Tahoma,Arial,sans-serif; }}
                a {{ color:inherit; }}
                @media (max-width:680px) {{
                        .email-card {{ border-radius:12px !important; }}
                        .email-pad {{ padding-left:16px !important; padding-right:16px !important; }}
                        .email-title {{ font-size:22px !important; }}
                        .showcase-grid td {{ display:block !important; width:100% !important; }}
                }}
        </style>
</head>
<body>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:22px 10px;">
                <tr>
                        <td align="center">
                                <table role="presentation" width="780" cellpadding="0" cellspacing="0" class="email-card" style="max-width:780px;width:100%;background:#ffffff;border:1px solid #dbe3ef;border-radius:16px;overflow:hidden;">
                                        <tr>
                                                <td class="email-pad" style="padding:22px 24px;background:{tokens['header_gradient']};">
                                                        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.88);">{escape(kicker)}</div>
                                                        <div class="email-title" style="margin-top:6px;font-size:28px;line-height:1.25;font-weight:700;color:#ffffff;">{escape(title)}</div>
                                                        {subtitle_html}
                                                </td>
                                        </tr>
                                        <tr>
                                                <td class="email-pad" style="padding:20px 24px 8px;">
                                                        {badge_html}
                                                        <div style="margin-top:14px;font-size:14px;line-height:1.7;color:#334155;">{body_html}</div>
                                                        {cta_html}
                                                </td>
                                        </tr>
                                        {showcase_html}
                                        <tr>
                                                <td class="email-pad" style="padding:14px 24px 18px;background:#f8fafc;border-top:1px solid #e5e7eb;">
                                                        <div style="font-size:12px;line-height:1.7;color:#64748b;">This is an automated message from Adarsh Admin. Please do not reply to this email.</div>
                                                        <div style="font-size:12px;line-height:1.7;color:#64748b;">Explore more products: <a href="{escape(website_url, quote=True)}" style="color:{tokens['accent']};text-decoration:none;font-weight:700;">{escape(website_url)}</a></div>
                                                </td>
                                        </tr>
                                </table>
                        </td>
                </tr>
        </table>
</body>
</html>"""


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


def get_security_alert_email_template(name, attempts, request=None):
        """Build suspicious-login alert email content."""
        body_html = (
                f"<p style=\"margin:0 0 12px;\">Hello <strong>{escape(name)}</strong>,</p>"
                "<p style=\"margin:0 0 12px;\">We detected multiple failed login attempts for your account.</p>"
                f"<p style=\"margin:0 0 12px;\">Attempts observed: <strong>{int(attempts)}</strong></p>"
                "<div style=\"border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:10px;background:#fef2f2;padding:10px 12px;font-size:12px;color:#991b1b;line-height:1.65;\">"
                "If this was not you, change your password immediately and contact support."
                "</div>"
        )
        html_content = build_unified_email_html(
                theme='security_alert',
                kicker='Security Alert',
                title='Multiple Failed Login Attempts',
                subtitle='We noticed unusual sign-in activity on your account.',
                body_html=body_html,
                cta_label='Open Panel Login',
                cta_url=_get_panel_login_url(request),
                request=request,
        )
        plain_content = (
                f"Security Alert\n\n"
                f"Hello {name},\n"
                f"We detected multiple failed login attempts for your account.\n"
                f"Attempts observed: {attempts}\n\n"
                "If this was not you, change your password immediately and contact support.\n"
        )
        return html_content, plain_content


def get_password_reset_otp_email_template(user_name, otp, expiry_minutes, request=None):
        """Build OTP reset email content."""
        body_html = (
                f"<p style=\"margin:0 0 12px;\">Hello <strong>{escape(user_name)}</strong>,</p>"
                f"<p style=\"margin:0 0 12px;\">Use the OTP below to reset your password. This code is valid for <strong>{int(expiry_minutes)} minutes</strong>.</p>"
                f"<div style=\"display:inline-block;padding:14px 18px;border:2px dashed #0f766e;border-radius:12px;background:#f0fdfa;font-size:34px;letter-spacing:12px;font-family:'Courier New',monospace;font-weight:700;color:#0f172a;\">{escape(str(otp))}</div>"
                "<p style=\"margin:12px 0 0;font-size:12px;color:#64748b;\">Enter this code on the password reset page.</p>"
                "<div style=\"margin-top:12px;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:10px;background:#fffbeb;padding:10px 12px;font-size:12px;color:#92400e;line-height:1.65;\">"
                "If you did not request this reset, ignore this email. Your password remains unchanged."
                "</div>"
        )
        html_content = build_unified_email_html(
                theme='otp',
                kicker='Password Reset OTP',
                title='Verify Your Password Reset',
                subtitle='For your security, this OTP expires quickly.',
                body_html=body_html,
                request=request,
        )
        plain_content = (
                f"Password Reset OTP\n\n"
                f"Hello {user_name},\n"
                f"Your OTP is: {otp}\n"
                f"This OTP is valid for {expiry_minutes} minutes.\n"
                "If you did not request this reset, ignore this email.\n"
        )
        return html_content, plain_content


def get_contact_submission_email_template(submission, request=None):
        """Build admin-facing contact form email content."""
        name = escape(submission.name or 'Unknown')
        email = escape(submission.email or 'Not provided')
        phone = escape(submission.phone or 'Not provided')
        subject_value = escape(submission.subject or 'No subject')
        message = escape(submission.message or '')
        submitted_at = escape(submission.created_at.strftime('%Y-%m-%d %H:%M:%S'))

        body_html = f"""
<p style="margin:0 0 12px;">A new contact form submission was received.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d1fae5;border-left:4px solid #0d9488;border-radius:12px;background:#f0fdfa;">
  <tr><td style="padding:12px 14px;">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Name</div>
        <div style="font-size:14px;font-weight:700;color:#0f172a;">{name}</div>
        <div style="height:8px;"></div>
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Email</div>
        <div style="font-size:14px;font-weight:700;color:#0f172a;">{email}</div>
        <div style="height:8px;"></div>
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Phone</div>
        <div style="font-size:14px;font-weight:700;color:#0f172a;">{phone}</div>
        <div style="height:8px;"></div>
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Subject</div>
        <div style="font-size:14px;font-weight:700;color:#0f172a;">{subject_value}</div>
  </td></tr>
</table>
<div style="margin-top:12px;border:1px solid #cbd5e1;border-radius:10px;background:#ffffff;padding:12px 14px;">
  <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Message</div>
  <div style="font-size:13px;line-height:1.7;color:#334155;white-space:pre-wrap;">{message}</div>
</div>
<p style="margin:12px 0 0;font-size:12px;color:#64748b;">Submitted at: {submitted_at}</p>
"""

        html_content = build_unified_email_html(
                theme='contact',
                kicker='Website Contact',
                title='New Contact Form Submission',
                subtitle='A website visitor sent a new message.',
                body_html=body_html,
                request=request,
        )
        plain_content = (
                f"New contact form submission\n\n"
                f"Name: {submission.name}\n"
                f"Email: {submission.email}\n"
                f"Phone: {submission.phone or 'Not provided'}\n"
                f"Subject: {submission.subject}\n\n"
                f"Message:\n{submission.message}\n\n"
                f"Submitted at: {submission.created_at.strftime('%Y-%m-%d %H:%M:%S')}\n"
        )
        return html_content, plain_content


def get_welcome_email_template(
        name,
        email,
        password,
        role,
        login_url,
        phone='',
        scenario='welcome',
        request=None,
):
        """Generate themed credential emails for first welcome and temp-password flows."""
        role_display = {
                'admin_staff': 'Admin Staff',
                'client': 'Client',
                'client_staff': 'Client Staff',
        }.get(role, role.replace('_', ' ').title())

        if phone and password == phone:
                password_display = 'Your Mobile Number'
                password_hint = 'Use your 10-digit mobile number as password.'
        else:
                password_display = password
                password_hint = 'Please save this password securely.'

        is_temp = scenario == 'temp_password'
        kicker = 'Temporary Access' if is_temp else 'Account Activation'
        title = 'Temporary Password Updated' if is_temp else 'Welcome to Adarsh Admin'
        subtitle = (
                'A temporary password has been set for your account.'
                if is_temp
                else 'Your account is ready and credentials are below.'
        )
        theme = 'temp_password' if is_temp else 'welcome'

        body_html = f"""
<p style="margin:0 0 12px;">Hello <strong>{escape(name)}</strong>,</p>
<p style="margin:0 0 14px;">{'Use these updated temporary credentials to access your account.' if is_temp else 'Your account has been created successfully. Use the credentials below to log in.'}</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe4f2;border-left:4px solid {'#ea580c' if is_temp else '#2563eb'};border-radius:12px;background:#f8fbff;margin:10px 0 12px;">
    <tr>
        <td style="padding:14px 16px;">
            <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Email</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;word-break:break-word;">{escape(email)}</div>
            <div style="height:10px;"></div>
            <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Password</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;font-family:'Courier New',monospace;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;display:inline-block;">{escape(password_display)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:6px;">{escape(password_hint)}</div>
            <div style="height:10px;"></div>
            <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Role</div>
            <div style="font-size:13px;font-weight:700;color:#0f172a;">{escape(role_display)}</div>
        </td>
    </tr>
</table>

<div style="border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:10px;background:#fffbeb;padding:10px 12px;font-size:12px;color:#92400e;line-height:1.65;">
    Security tip: change your password after login and never share credentials.
</div>
"""

        html_content = build_unified_email_html(
                theme=theme,
                kicker=kicker,
                title=title,
                subtitle=subtitle,
                body_html=body_html,
                cta_label='Login to Panel',
                cta_url=login_url,
                badge_text=role_display,
                request=request,
        )

        plain_content = (
                f"{'Temporary Password Updated' if is_temp else 'Welcome to Adarsh Admin'}\n\n"
                f"Hello {name},\n\n"
                f"Email: {email}\n"
                f"Password: {password_display}\n"
                f"Role: {role_display}\n"
                f"Login URL: {login_url}\n\n"
                f"{password_hint}\n"
                "Security tip: change your password after login and never share credentials.\n"
        )

        return html_content, plain_content


def send_welcome_email(name, email, password, role, request=None, phone='', email_variant='welcome', **kwargs):
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
            phone=phone,
            scenario=email_variant,
            request=request,
        )

        if email_variant == 'temp_password':
            subject = '🔐 Your Temporary Password — Adarsh Admin'
        else:
            subject = '🎉 Welcome to Adarsh Admin — Your Account is Ready'
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
        return False, 'Failed to send email. Please try again.'


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

        login_url = _get_panel_login_url(request)
        body_html = (
            f"<p style=\"margin:0 0 12px;\">Hello <strong>{escape(name)}</strong>,</p>"
            "<p style=\"margin:0 0 12px;\">Your account password was updated by an administrator.</p>"
            "<p style=\"margin:0 0 12px;\">If this was not requested by you, contact your administrator immediately.</p>"
            "<div style=\"border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:10px;background:#fff1f2;padding:10px 12px;font-size:12px;color:#991b1b;line-height:1.65;\">"
            "For safety, change your password after login and keep it private."
            "</div>"
        )
        html_content = build_unified_email_html(
            theme='password_change',
            kicker='Security Notice',
            title='Password Updated',
            subtitle='A security change was made to your account credentials.',
            body_html=body_html,
            cta_label='Login to Panel',
            cta_url=login_url,
            request=request,
        )

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

                body_html = (
                    f"<p style=\"margin:0 0 12px;\">Hello <strong>{escape(display_name)}</strong>,</p>"
                    "<p style=\"margin:0 0 12px;\">A Pro User shared a secure panel login link for your account.</p>"
                    f"<p style=\"margin:0 0 12px;\">Issued by: <strong>{escape(issuer_name)}</strong></p>"
                    "<div style=\"border:1px solid #cbd5e1;border-left:4px solid #4f46e5;border-radius:10px;background:#f8fafc;padding:10px 12px;font-size:12px;color:#334155;line-height:1.65;\">"
                    "If you did not request this, contact support immediately."
                    "</div>"
                )
                html_content = build_unified_email_html(
                    theme='welcome',
                    kicker='Emergency Access',
                    title='Secure Panel Login Link',
                    subtitle='Use this link to access the panel login flow directly.',
                    body_html=body_html,
                    cta_label='Open Panel Login',
                    cta_url=login_url,
                    request=request,
                )

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

                body_html = (
                    "<p style=\"margin:0 0 12px;\">Public website domain is now in <strong>Not Found Mode</strong>.</p>"
                    "<p style=\"margin:0 0 12px;\">If you need panel access, use the secure login link below.</p>"
                    f"<p style=\"margin:0 0 12px;\">Updated by: <strong>{escape(actor)}</strong></p>"
                    "<div style=\"border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:10px;background:#fef2f2;padding:10px 12px;font-size:12px;color:#991b1b;line-height:1.65;\">"
                    "This is an automated notification sent to all active users."
                    "</div>"
                )
                html_content = build_unified_email_html(
                    theme='alert',
                    kicker='Website Access Mode',
                    title='Not Found Mode Enabled',
                    subtitle='Website is currently gated while panel access remains available.',
                    body_html=body_html,
                    cta_label='Open Panel Login',
                    cta_url=login_url,
                    request=request,
                )

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