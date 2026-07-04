import uuid
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.validators import RegexValidator
from shared.constants import Role

class UserManager(BaseUserManager):
    def create_user(self, email=None, username=None, password=None, **extra_fields):
        if not email and not username:
            raise ValueError('Either email or username must be set')
        if email:
            email = self.normalize_email(email)
        user = self.model(email=email, username=username, **extra_fields)
        if password:
            user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, username, password=None, **extra_fields):
        extra_fields.setdefault('role', Role.PRO_USER)
        return self.create_user(email, username, password, **extra_fields)

class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, null=True, blank=True)
    username = models.CharField(max_length=150, unique=True, null=True, blank=True)
    
    phone_regex = RegexValidator(regex=r'^\+?1?\d{9,15}$', message="Phone number must be entered in the format: '+999999999'. Up to 15 digits allowed.")
    phone = models.CharField(validators=[phone_regex], max_length=17, unique=True, null=True, blank=True)
    
    role = models.CharField(max_length=20, choices=Role.choices)
    
    organization = models.ForeignKey('organizations.Organization', on_delete=models.RESTRICT, null=True, blank=True, related_name='users')
    parent_client = models.ForeignKey('self', on_delete=models.RESTRICT, null=True, blank=True, related_name='assistants')
    
    is_active = models.BooleanField(default=True)
    is_deleted = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    class Meta:
        db_table = 'users_user'
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['username']),
            models.Index(fields=['phone']),
            models.Index(fields=['role']),
        ]
        constraints = [
            models.UniqueConstraint(fields=['email'], condition=models.Q(email__isnull=False), name='unique_non_null_email'),
            models.UniqueConstraint(fields=['username'], condition=models.Q(username__isnull=False), name='unique_non_null_username'),
            models.UniqueConstraint(fields=['phone'], condition=models.Q(phone__isnull=False), name='unique_non_null_phone'),
            models.UniqueConstraint(fields=['role'], condition=models.Q(role=Role.PRO_USER), name='unique_pro_user'),
        ]

    def soft_delete(self):
        self.is_deleted = True
        self.is_active = False
        self.save()

class OperatorAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    operator = models.ForeignKey(User, on_delete=models.CASCADE, related_name='assigned_clients')
    client = models.ForeignKey(User, on_delete=models.CASCADE, related_name='assigned_operators')
    assigned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='operator_assignments_created')
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'users_operator_assignment'
        unique_together = ('operator', 'client')
        indexes = [
            models.Index(fields=['operator', 'client']),
        ]

class OTPToken(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='otp_tokens')
    otp = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)

    class Meta:
        db_table = 'users_otp_token'
        indexes = [
            models.Index(fields=['otp', 'user']),
        ]
