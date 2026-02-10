import logging
import os
import random
import re
import shutil
import string
import uuid

from django.db import models
from django.conf import settings

logger = logging.getLogger(__name__)


def generate_folder_code_from_name(name):
    """
    Generate a 5-character code from client name:
    - If 3+ words: use first char of each word (up to 5)
    - If 2 or fewer words: use first 2-3 chars of each word
    Always returns exactly 5 uppercase characters (padded with X if needed)
    """
    if not name:
        return 'XXXXX'
    
    # Remove special characters and split into words
    words = re.sub(r'[^a-zA-Z0-9\s]', '', name).split()
    words = [w for w in words if w]  # Remove empty strings
    
    if not words:
        return 'XXXXX'
    
    code = ''
    if len(words) >= 3:
        # 3+ words: use first char of each word
        for word in words[:5]:
            if word:
                code += word[0].upper()
    elif len(words) == 2:
        # 2 words: use first 2-3 chars of each
        code = words[0][:3].upper() + words[1][:2].upper()
    else:
        # 1 word: use first 5 chars
        code = words[0][:5].upper()
    
    # Ensure exactly 5 characters
    code = code[:5].ljust(5, 'X')
    return code


def generate_unique_suffix():
    """Generate 5 random alphanumeric characters"""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))


class Client(models.Model):
    """
    Client model - managed by principals/management
    
    NOTE: app_label='core' preserved for migration compatibility.
    Model code moved from core/models.py to client/models.py
    """
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('suspended', 'Suspended'),
    ]
    
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='client_profile')
    
    # Unique folder ID for storing images (never changes even if client name changes)
    image_folder_uuid = models.UUIDField(default=uuid.uuid4, editable=False)
    
    # Image folder code: 5 chars from name + 5 unique chars = 10 chars max
    # Format: {ABCDE}{12345} where ABCDE is from client name, 12345 is unique suffix
    image_folder_code = models.CharField(max_length=10, blank=True, null=True, unique=True)
    # Store the unique suffix separately (never changes)
    image_folder_suffix = models.CharField(max_length=5, blank=True, null=True)
    
    # Basic Information
    name = models.CharField(max_length=200)
    photo = models.ImageField(upload_to='clients_imgs/', blank=True, null=True)
    
    # Address
    address = models.TextField(blank=True, null=True)
    city = models.CharField(max_length=100, blank=True, null=True)
    state = models.CharField(max_length=100, blank=True, null=True)
    pincode = models.CharField(max_length=10, blank=True, null=True)
    
    # ID Card Client List Permission
    perm_idcard_client_list = models.BooleanField(default=True)
    
    # ID Card Setting Permissions (sensitive — default OFF)
    perm_idcard_setting_list = models.BooleanField(default=False)
    perm_idcard_setting_add = models.BooleanField(default=False)
    perm_idcard_setting_edit = models.BooleanField(default=False)
    perm_idcard_setting_delete = models.BooleanField(default=False)
    perm_idcard_setting_status = models.BooleanField(default=False)
    
    # Group/Table Create & Delete (admin-controlled — default OFF)
    perm_idcard_group_create = models.BooleanField(default=False)
    perm_idcard_group_delete = models.BooleanField(default=False)
    
    # ID Card List Permissions (view lists — default ON)
    perm_idcard_pending_list = models.BooleanField(default=True)
    perm_idcard_verified_list = models.BooleanField(default=True)
    perm_idcard_pool_list = models.BooleanField(default=True)
    perm_idcard_approved_list = models.BooleanField(default=True)
    perm_idcard_download_list = models.BooleanField(default=True)
    perm_idcard_reprint_list = models.BooleanField(default=False)
    
    # ID Card Action Permissions (common actions — default ON, dangerous — default OFF)
    perm_idcard_add = models.BooleanField(default=True)
    perm_idcard_edit = models.BooleanField(default=True)
    perm_idcard_delete = models.BooleanField(default=True)
    perm_idcard_info = models.BooleanField(default=True)
    perm_idcard_approve = models.BooleanField(default=True)
    perm_idcard_verify = models.BooleanField(default=True)
    perm_idcard_bulk_upload = models.BooleanField(default=True)
    perm_idcard_bulk_download = models.BooleanField(default=True)
    perm_idcard_created_at = models.BooleanField(default=False)
    perm_idcard_updated_at = models.BooleanField(default=False)
    perm_idcard_delete_from_pool = models.BooleanField(default=False)
    perm_delete_all_idcard = models.BooleanField(default=False)
    perm_reupload_idcard_image = models.BooleanField(default=True)
    perm_idcard_retrieve = models.BooleanField(default=True)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active', db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name
    
    def generate_folder_code(self):
        """Generate and set the image folder code based on client name"""
        name_part = generate_folder_code_from_name(self.name)
        
        # Generate unique suffix if not already set
        if not self.image_folder_suffix:
            self.image_folder_suffix = generate_unique_suffix()
        
        self.image_folder_code = f"{name_part}{self.image_folder_suffix}"
        return self.image_folder_code
    
    def get_image_folder_path(self):
        """Get the full folder path for this client's images"""
        if not self.image_folder_code:
            self.generate_folder_code()
            self.save(update_fields=['image_folder_code', 'image_folder_suffix'])
        return f"adarshimg/{self.image_folder_code}"
    
    def ensure_image_folder_exists(self):
        """Create the image folder if it doesn't exist"""
        from django.conf import settings
        folder_path = os.path.join(settings.MEDIA_ROOT, self.get_image_folder_path())
        os.makedirs(folder_path, exist_ok=True)
        return folder_path
    
    def rename_image_folder(self, old_name):
        """
        Rename the image folder when client name changes.
        Only updates the first 5 chars (name part), suffix stays same.
        Also updates all card field_data paths to reflect the new folder name.
        """
        from django.conf import settings
        
        if not self.image_folder_suffix:
            # No folder exists yet
            return
        
        old_code = self.image_folder_code
        old_folder_path = os.path.join(settings.MEDIA_ROOT, f"adarshimg/{old_code}")
        
        # Generate new code with updated name
        new_name_part = generate_folder_code_from_name(self.name)
        new_code = f"{new_name_part}{self.image_folder_suffix}"
        new_folder_path = os.path.join(settings.MEDIA_ROOT, f"adarshimg/{new_code}")
        
        # Rename folder if it exists and codes are different
        if old_code != new_code and os.path.exists(old_folder_path):
            try:
                os.rename(old_folder_path, new_folder_path)
                logger.debug("Renamed folder: %s -> %s", old_code, new_code)
                
                # Update all card field_data paths that reference the old folder code
                from workflows.models import IDCard
                old_prefix = f'adarshimg/{old_code}'
                new_prefix = f'adarshimg/{new_code}'
                for card in IDCard.objects.filter(table__group__client=self).iterator():
                    fd = card.field_data or {}
                    updated = False
                    for key, val in fd.items():
                        if isinstance(val, str) and old_prefix in val:
                            fd[key] = val.replace(old_prefix, new_prefix)
                            updated = True
                    if updated:
                        card.field_data = fd
                        card.save(update_fields=['field_data'])
                
            except Exception as e:
                logger.warning("Could not rename folder %s to %s: %s", old_code, new_code, e)
        
        self.image_folder_code = new_code
    
    def delete_image_folder(self):
        """Delete the entire image folder and all contents"""
        from django.conf import settings
        
        if not self.image_folder_code:
            return
        
        folder_path = os.path.join(settings.MEDIA_ROOT, f"adarshimg/{self.image_folder_code}")
        if os.path.exists(folder_path):
            try:
                shutil.rmtree(folder_path)
                logger.debug("Deleted folder: %s", self.image_folder_code)
            except Exception as e:
                logger.warning("Could not delete folder %s: %s", self.image_folder_code, e)
    
    def save(self, *args, **kwargs):
        # Check if this is an update and name changed
        if self.pk:
            try:
                old_instance = Client.objects.get(pk=self.pk)
                if old_instance.name != self.name and old_instance.image_folder_code:
                    self.rename_image_folder(old_instance.name)
            except Client.DoesNotExist:
                pass
        
        # Generate folder code if not set
        if not self.image_folder_code:
            self.generate_folder_code()
        
        super().save(*args, **kwargs)
    
    def delete(self, *args, **kwargs):
        # Delete image folder when client is deleted
        self.delete_image_folder()
        super().delete(*args, **kwargs)
    
    class Meta:
        app_label = 'core'  # Keep migration compatibility - model stays in core migrations
        ordering = ['-created_at']
