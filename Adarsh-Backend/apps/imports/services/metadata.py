import json
import logging
from io import BytesIO
from PIL import Image
from PIL.PngImagePlugin import PngInfo

logger = logging.getLogger(__name__)

class ImageMetadataService:
    @staticmethod
    def embed_metadata(image_bytes: bytes, fmt: str, metadata_dict: dict) -> bytes:
        """
        Embeds Adarsh metadata into image bytes based on the format (JPEG/PNG).
        Returns the modified image bytes.
        """
        try:
            img = Image.open(BytesIO(image_bytes))
            out_io = BytesIO()
            json_str = json.dumps(metadata_dict)
            
            fmt_upper = (fmt or img.format or 'PNG').upper()
            if fmt_upper in ['JPEG', 'JPG']:
                # For JPEG, write JSON to EXIF UserComment (tag 37510)
                exif = img.getexif()
                # 37510 is UserComment in EXIF
                exif[37510] = json_str
                img.save(out_io, format='JPEG', exif=exif)
            elif fmt_upper == 'PNG':
                # For PNG, write JSON to PNG text chunk
                png_info = PngInfo()
                png_info.add_text("AdarshMetadata", json_str)
                img.save(out_io, format='PNG', pnginfo=png_info)
            else:
                # Fallback to saving normally without metadata if not supported format
                img.save(out_io, format=fmt_upper)
                
            out_io.seek(0)
            return out_io.getvalue()
        except Exception as e:
            logger.warning(f"Failed to embed metadata: {e}")
            return image_bytes

    @staticmethod
    def extract_metadata(image_bytes: bytes) -> dict:
        """
        Extracts Adarsh metadata from image bytes.
        Returns a dict of extracted metadata or empty dict.
        """
        try:
            img = Image.open(BytesIO(image_bytes))
            
            # Check PNG info text chunks
            if img.format == 'PNG':
                meta_str = img.info.get("AdarshMetadata")
                if meta_str:
                    return json.loads(meta_str)
                    
            # Check JPEG EXIF UserComment
            exif = img.getexif()
            if exif:
                # 37510 is UserComment
                meta_str = exif.get(37510)
                if meta_str:
                    if isinstance(meta_str, bytes):
                        # EXIF bytes could have encoding prefix (e.g. ASCII\0\0\0)
                        # but if we stored plain JSON, we try decoding it
                        try:
                            meta_str = meta_str.decode('utf-8', errors='ignore')
                        except Exception:
                            pass
                    # Exif UserComment sometimes starts with ASCII/UNICODE prefix
                    if isinstance(meta_str, str):
                        # Remove common EXIF prefixes if present
                        for prefix in ["ASCII\x00\x00\x00", "UNICODE\x00", "ASCII", "UNICODE"]:
                            if meta_str.startswith(prefix):
                                meta_str = meta_str[len(prefix):]
                        meta_str = meta_str.strip()
                        return json.loads(meta_str)
        except Exception as e:
            logger.warning(f"Failed to extract metadata: {e}")
        return {}
