"""
Email Utility Functions
Contains: Email sending utilities with beautiful HTML templates
"""
import secrets
import string
from django.core.mail import send_mail
from django.conf import settings


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


def get_welcome_email_template(name, email, password, role, login_url):
    """
    Generate a beautifully designed HTML email for welcome/credentials
    """
    role_display = {
        'admin_staff': 'Admin Staff',
        'client': 'Client',
        'client_staff': 'Client Staff',
    }.get(role, role.replace('_', ' ').title())
    
    html_content = f'''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f7fa; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08); overflow: hidden;">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 40px 30px; text-align: center;">
                            <div style="width: 70px; height: 70px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                <span style="font-size: 32px; color: #fff;">🎉</span>
                            </div>
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">Welcome Aboard!</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">Your account has been created successfully</p>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 40px;">
                            <p style="color: #333; font-size: 16px; margin: 0 0 20px; line-height: 1.6;">
                                Hello <strong style="color: #667eea;">{name}</strong>,
                            </p>
                            
                            <p style="color: #555; font-size: 15px; margin: 0 0 25px; line-height: 1.6;">
                                Your account has been created as <strong style="color: #764ba2;">{role_display}</strong>. 
                                Below are your login credentials. Please keep them secure.
                            </p>
                            
                            <!-- Credentials Box -->
                            <div style="background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%); border-radius: 12px; padding: 25px; margin: 25px 0; border-left: 4px solid #667eea;">
                                <h3 style="color: #333; margin: 0 0 20px; font-size: 16px; font-weight: 600;">
                                    🔐 Your Login Credentials
                                </h3>
                                
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                    <tr>
                                        <td style="padding: 10px 0;">
                                            <span style="color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Email</span>
                                            <div style="color: #333; font-size: 16px; font-weight: 500; margin-top: 5px; word-break: break-all;">
                                                {email}
                                            </div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-top: 1px dashed #ddd;">
                                            <span style="color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Password</span>
                                            <div style="color: #333; font-size: 16px; font-weight: 600; margin-top: 5px; font-family: 'Courier New', monospace; background: #fff; padding: 10px 15px; border-radius: 8px; border: 1px solid #e0e5ff;">
                                                📱 Your Mobile Number
                                            </div>
                                            <p style="color: #888; font-size: 13px; margin: 8px 0 0; font-style: italic;">
                                                (Use your 10-digit mobile number as password)
                                            </p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-top: 1px dashed #ddd;">
                                            <span style="color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Role</span>
                                            <div style="margin-top: 5px;">
                                                <span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; font-size: 13px; font-weight: 500; padding: 5px 15px; border-radius: 20px;">
                                                    {role_display}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                            </div>
                            
                            <!-- Login Button -->
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="{login_url}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 40px; border-radius: 30px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                                    🚀 Login Now
                                </a>
                            </div>
                            
                            <!-- How to Reset Password -->
                            <div style="background: #f0fff4; border-radius: 10px; padding: 20px; margin-top: 25px; border-left: 4px solid #48bb78;">
                                <h4 style="color: #276749; margin: 0 0 15px; font-size: 15px; font-weight: 600;">
                                    🔄 How to Reset Your Password
                                </h4>
                                <ol style="color: #2f855a; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
                                    <li>Go to the login page and click on <strong>"Forgot Password?"</strong></li>
                                    <li>Enter your email address and submit</li>
                                    <li>You will receive an OTP on your email</li>
                                    <li>Enter the OTP and set your new password</li>
                                </ol>
                            </div>
                            
                            <!-- Security Notice -->
                            <div style="background: #fff8e6; border-radius: 10px; padding: 15px 20px; margin-top: 20px; border-left: 4px solid #f5a623;">
                                <p style="color: #856404; font-size: 14px; margin: 0; line-height: 1.5;">
                                    <strong>⚠️ Security Tip:</strong> We recommend changing your password after first login for better security. Never share your credentials with anyone.
                                </p>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f8f9fa; padding: 25px 40px; text-align: center; border-top: 1px solid #eee;">
                            <p style="color: #999; font-size: 13px; margin: 0 0 10px;">
                                This is an automated message. Please do not reply to this email.
                            </p>
                            <p style="color: #999; font-size: 12px; margin: 0;">
                                © 2026 Adarsh Admin. All rights reserved.
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
'''
    
    # Plain text fallback
    plain_content = f'''
Welcome to Adarsh Admin!

Hello {name},

Your account has been created as {role_display}.

Your Login Credentials:
------------------------
Email: {email}
Password: Your Mobile Number (10-digit)
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


def send_welcome_email(name, email, password, role, request=None):
    """
    Send a welcome email with login credentials to new users.
    
    Args:
        name: User's full name
        email: User's email address
        password: The generated password
        role: User's role (admin_staff, client, client_staff)
        request: Django request object (optional, for building absolute URL)
    
    Returns:
        tuple: (success: bool, message: str)
    """
    try:
        # Check if email settings are configured
        if not settings.EMAIL_HOST_USER:
            return False, 'Email settings not configured. Please add EMAIL_HOST_USER in .env file.'
        
        # Build login URL using SITE_URL from settings
        site_url = getattr(settings, 'SITE_URL', 'http://localhost:8000')
        if request:
            login_url = request.build_absolute_uri('/panel/auth/login/')
        else:
            login_url = f'{site_url}/panel/auth/login/'
        
        # Get email templates
        html_content, plain_content = get_welcome_email_template(
            name=name,
            email=email,
            password=password,
            role=role,
            login_url=login_url
        )
        
        # Send the email
        from django.core.mail import EmailMultiAlternatives
        
        subject = '🎉 Welcome to Adarsh Admin - Your Account is Ready!'
        from_email = settings.EMAIL_HOST_USER
        to_email = [email]
        
        msg = EmailMultiAlternatives(subject, plain_content, from_email, to_email)
        msg.attach_alternative(html_content, "text/html")
        msg.send(fail_silently=False)
        
        return True, 'Welcome email sent successfully!'
        
    except Exception as e:
        return False, f'Failed to send email: {str(e)}'
