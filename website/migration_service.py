import os
import zipfile
import logging
import tempfile
from datetime import datetime
from django.conf import settings

logger = logging.getLogger(__name__)

class WebsiteMigrationService:
    """
    Service to bundle website-related data for migration.
    Organizes files into a clear folder structure within the ZIP.
    """

    @classmethod
    def get_website_media_mapping(cls):
        """
        Mapping of source media subdirectories to their 
        destination folder names in the ZIP.
        """
        return {
            'images/Products': 'website_media/products',
            'videos/Portfolio': 'website_media/portfolio_videos',
            'images/Avatars': 'website_media/avatars',
            'images/TestimonialAttachments': 'website_media/testimonial_attachments',
            'images/Clients/Logos': 'website_media/client_logos',
        }

    @classmethod
    def create_migration_bundle(cls):
        """
        Creates a ZIP bundle with an organized folder structure.
        """
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        zip_filename = f"adarsh_website_migration_{timestamp}.zip"
        temp_dir = tempfile.gettempdir()
        zip_path = os.path.join(temp_dir, zip_filename)

        db_path = os.path.join(settings.BASE_DIR, 'db.sqlite3')
        media_root = settings.MEDIA_ROOT

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # 1. Database Folder
            if os.path.exists(db_path):
                zipf.write(db_path, arcname='database/db.sqlite3')
                logger.info("Added database/db.sqlite3 to bundle")
            
            # 2. Website Media Folders
            mapping = cls.get_website_media_mapping()
            for src_sub, dest_folder in mapping.items():
                full_src_path = os.path.join(media_root, src_sub)
                
                if os.path.exists(full_src_path):
                    file_count = 0
                    for root, dirs, files in os.walk(full_src_path):
                        for file in files:
                            file_path = os.path.join(root, file)
                            # Create arcname: dest_folder + relative path from full_src_path
                            rel_path = os.path.relpath(file_path, full_src_path)
                            arcname = os.path.join(dest_folder, rel_path)
                            zipf.write(file_path, arcname=arcname)
                            file_count += 1
                    logger.info("Added %d files to %s", file_count, dest_folder)

            # 3. Manifest
            manifest_content = f"""{{
    "export_timestamp": "{timestamp}",
    "project_name": "Adarsh ID Cards",
    "export_type": "Website Migration Bundle",
    "contents": {{
        "database": ["db.sqlite3 (SQLite)"],
        "website_media": ["Products", "Videos", "Avatars", "Testimonials", "Logos"],
        "idcard_media": ["adarshimg", "card_media", "staff_imgs"]
    }},
    "instructions": "Extract this ZIP. 'website_media' contains assets for your new website project. 'idcard_media' contains legacy ID card assets. Use 'database/db.sqlite3' for full data recovery."
}}"""
            zipf.writestr('manifest.json', manifest_content)

        return zip_path
