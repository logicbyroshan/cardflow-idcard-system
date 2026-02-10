"""
Base Service Module
Contains: ServiceResult dataclass, BaseService class, common utilities
"""
from dataclasses import dataclass, field
from typing import Any, Optional, Dict, List, Union
import re

# Import canonical constants from mediafiles
from mediafiles.constants import (
    IMAGE_FIELD_TYPES,
    IMAGE_FIELD_NAME_PATTERNS,
    VALID_IMAGE_EXTENSIONS,
)


@dataclass
class ServiceResult:
    """
    Standard result object returned by all service methods.
    
    Usage:
        # Success
        return ServiceResult(success=True, data={'client': client_dict}, message='Created!')
        
        # Failure
        return ServiceResult(success=False, message='Email already exists')
        
        # In views
        result = ClientService.create(data)
        if result.success:
            return JsonResponse({'success': True, 'client': result.data['client']})
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    """
    success: bool
    message: str = ''
    data: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    
    def to_response_dict(self) -> dict:
        """Convert to dict suitable for JsonResponse"""
        response = {'success': self.success}
        if self.message:
            response['message'] = self.message
        if self.data:
            response.update(self.data)
        if self.errors:
            response['errors'] = self.errors
        return response


class BaseService:
    """
    Base class for all services.
    Provides common utilities and patterns.
    
    NOTE: Uses canonical constants from mediafiles.constants
    """
    
    # Re-export constants as class attributes for backward compatibility
    IMAGE_FIELD_TYPES = IMAGE_FIELD_TYPES
    IMAGE_FIELD_NAME_PATTERNS = IMAGE_FIELD_NAME_PATTERNS
    VALID_IMAGE_EXTENSIONS = VALID_IMAGE_EXTENSIONS
    
    # Valid ID card statuses
    VALID_STATUSES = ['pending', 'verified', 'pool', 'approved', 'download', 'reprint']
    
    @staticmethod
    def parse_bool(value: Any) -> bool:
        """Parse boolean from various input types"""
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ('true', '1', 'yes', 'on')
        return bool(value)
    
    @staticmethod
    def normalize_name(name: str) -> str:
        """Normalize field names for comparison (remove spaces, underscores, etc.)"""
        if not name:
            return ''
        return re.sub(r'[^a-z0-9]', '', name.lower())
    
    @staticmethod
    def normalize_image_identifier(identifier: str) -> str:
        """
        Normalize an image identifier for consistent matching.
        
        Handles:
        - Case insensitivity (P1 == p1)
        - Whitespace (leading/trailing/multiple spaces)
        - Numeric formats (1.0 -> 1, 001 -> 1 for pure numbers)
        - Extension removal if present (.jpg, .png, etc.)
        
        Args:
            identifier: Raw identifier from Excel or ZIP filename
            
        Returns:
            Normalized uppercase string for matching
        """
        if not identifier:
            return ''
        
        # Convert to string and strip whitespace
        result = str(identifier).strip()
        
        # Handle numeric types (from Excel: 1.0 -> "1")
        try:
            float_val = float(result)
            if float_val == int(float_val):
                result = str(int(float_val))
        except (ValueError, TypeError):
            pass
        
        # Remove common image extensions if present
        lower_result = result.lower()
        for ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
            if lower_result.endswith(ext):
                result = result[:-len(ext)]
                break
        
        # Normalize internal whitespace (multiple spaces -> single)
        result = ' '.join(result.split())
        
        # Convert to uppercase for consistent matching
        return result.upper()
    
    @staticmethod
    def uppercase_dict_values(data: dict) -> dict:
        """Convert all string values in dict to uppercase"""
        result = {}
        for key, value in data.items():
            if isinstance(value, str):
                result[key] = value.upper()
            else:
                result[key] = value
        return result
    
    @classmethod
    def is_image_field_by_name(cls, field_name: str) -> bool:
        """Check if field name suggests it's an image field"""
        if not field_name:
            return False
        import re
        name_lower = field_name.lower()
        # Use word boundary matching to avoid false positives like 'designation' matching 'sign'
        for pattern in cls.IMAGE_FIELD_NAME_PATTERNS:
            # Create regex with word boundary for patterns that could be substrings
            if re.search(r'\b' + re.escape(pattern) + r'\b', name_lower):
                return True
            # Also check exact match or if field name starts/ends with pattern
            if name_lower == pattern:
                return True
        return False
    
    @classmethod
    def is_image_field(cls, field: dict) -> bool:
        """Check if a field is an image field by type OR name"""
        field_type = field.get('type', 'text')
        field_name = field.get('name', '')
        return field_type in cls.IMAGE_FIELD_TYPES or cls.is_image_field_by_name(field_name)
    
    @classmethod
    def get_text_fields(cls, table_fields: List[dict]) -> List[dict]:
        """Filter table fields to only text fields (exclude images)"""
        return [f for f in table_fields if not cls.is_image_field(f)]
    
    @classmethod
    def get_image_fields(cls, table_fields: List[dict]) -> List[dict]:
        """Filter table fields to only image fields"""
        return [f for f in table_fields if cls.is_image_field(f)]
    
    @classmethod
    def get_image_field_names(cls, table_fields: List[dict]) -> List[str]:
        """Get list of image field names from table fields"""
        return [f['name'] for f in table_fields if cls.is_image_field(f)]
    
    @staticmethod
    def levenshtein_distance(s1: str, s2: str) -> int:
        """Calculate Levenshtein distance between two strings"""
        if len(s1) < len(s2):
            return BaseService.levenshtein_distance(s2, s1)
        if len(s2) == 0:
            return len(s1)
        
        previous_row = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row
        return previous_row[-1]
    
    @classmethod
    def find_best_field_match(cls, header: str, available_fields: List[str]) -> Optional[str]:
        """
        Find best match for a header using fuzzy matching.
        Returns matched field name or None.
        """
        normalized_header = cls.normalize_name(header)
        
        # First try exact match
        for field in available_fields:
            if cls.normalize_name(field) == normalized_header:
                return field
        
        # Then try fuzzy match
        best_match = None
        best_distance = float('inf')
        
        for field in available_fields:
            normalized_field = cls.normalize_name(field)
            distance = cls.levenshtein_distance(normalized_header, normalized_field)
            
            # Allow up to 2 char differences, but for short strings allow only 1
            max_distance = 1 if len(normalized_field) < 5 else 2
            
            if distance <= max_distance and distance < best_distance:
                best_distance = distance
                best_match = field
        
        return best_match
    
    @staticmethod
    def clean_filename_for_export(name: str) -> str:
        """Clean a name for use in export filenames"""
        return re.sub(r'[^\w\s-]', '', name).strip().replace(' ', '_')
    
    @classmethod
    def validate_bulk_upload_data(cls, identifiers_by_field: Dict[str, List[str]]) -> Dict[str, Any]:
        """
        Validate bulk upload data for potential issues.
        
        Args:
            identifiers_by_field: Dict mapping field names to list of identifiers
            
        Returns:
            Dict with 'valid' bool, 'warnings' list, and 'duplicates' dict
        """
        warnings = []
        duplicates_by_field = {}
        
        for field_name, identifiers in identifiers_by_field.items():
            # Check for duplicates within same column
            normalized = [cls.normalize_image_identifier(i) for i in identifiers if i]
            seen = set()
            duplicates = set()
            for ident in normalized:
                if ident and ident in seen:
                    duplicates.add(ident)
                seen.add(ident)
            
            if duplicates:
                warnings.append(f"Duplicate identifiers in '{field_name}': {', '.join(list(duplicates)[:5])}")
                duplicates_by_field[field_name] = list(duplicates)
        
        return {
            'valid': len(warnings) == 0,
            'warnings': warnings,
            'duplicates': duplicates_by_field
        }
    
    @classmethod
    def validate_excel_identifiers_early(cls, rows_data: list, image_ref_columns: Dict[str, int]) -> Dict[str, Any]:
        """
        Fail-fast validation: Check for duplicate image identifiers BEFORE processing.
        
        Args:
            rows_data: List of row tuples from Excel
            image_ref_columns: Dict mapping field names to column indices
            
        Returns:
            Dict with 'valid' bool, 'errors' list of duplicate descriptions
        """
        errors = []
        
        for field_name, col_idx in image_ref_columns.items():
            identifiers = []
            for row_num, row in enumerate(rows_data, start=2):
                if col_idx < len(row):
                    cell_value = row[col_idx]
                    if cell_value is not None and str(cell_value).strip():
                        # Handle numeric Excel values
                        if isinstance(cell_value, float) and cell_value == int(cell_value):
                            identifiers.append((str(int(cell_value)), row_num))
                        elif isinstance(cell_value, int):
                            identifiers.append((str(cell_value), row_num))
                        else:
                            identifiers.append((str(cell_value).strip(), row_num))
            
            # Normalize and check for duplicates
            seen = {}  # normalized -> (original, row_num)
            for original, row_num in identifiers:
                normalized = cls.normalize_image_identifier(original)
                if normalized:
                    if normalized in seen:
                        prev_orig, prev_row = seen[normalized]
                        errors.append(
                            f"Duplicate identifier '{original}' in column '{field_name}' "
                            f"at rows {prev_row} and {row_num}"
                        )
                    else:
                        seen[normalized] = (original, row_num)
        
        return {
            'valid': len(errors) == 0,
            'errors': errors[:10]  # Limit to first 10 errors
        }
    
    @classmethod  
    def build_zip_photo_index(cls, zip_photos_dict: Dict[str, bytes]) -> Dict[str, dict]:
        """
        Build a normalized index from ZIP photos for consistent matching.
        
        Args:
            zip_photos_dict: Dict of {filename: image_bytes}
            
        Returns:
            Dict with normalized keys pointing to {bytes, ext, original_name}
        """
        index = {}
        for filename, data in zip_photos_dict.items():
            base_name = filename.split('/')[-1]  # Handle nested paths
            name_without_ext, ext = base_name.rsplit('.', 1) if '.' in base_name else (base_name, 'jpg')
            
            # Normalize the key for matching
            normalized_key = cls.normalize_image_identifier(name_without_ext)
            
            if normalized_key:
                index[normalized_key] = {
                    'bytes': data if isinstance(data, bytes) else data.get('bytes'),
                    'ext': f'.{ext.lower()}' if not ext.startswith('.') else ext.lower(),
                    'original_name': base_name
                }
        
        return index


class StreamingZipIndex:
    """
    A memory-efficient ZIP file handler that builds an index of filenames
    without extracting all content into memory.
    
    Usage:
        with StreamingZipIndex(zip_file_obj) as index:
            # Check if a file exists
            if 'P001' in index:
                # Extract only when needed
                photo_info = index.get_photo('P001')
                image_bytes = photo_info['bytes']
    
    This is preferred over loading entire ZIP into memory for large uploads.
    """
    
    VALID_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}
    
    def __init__(self, zip_file):
        """
        Initialize with a file-like object or path.
        
        Args:
            zip_file: Django uploaded file, file-like object, or path string
        """
        import zipfile
        from io import BytesIO
        
        self._zip_file = zip_file
        self._zf = None
        self._index = {}  # normalized_key -> zip_info
        self._raw_index = {}  # normalized_key -> {ext, original_name, zip_filename}
        
    def __enter__(self):
        import zipfile
        from io import BytesIO
        
        # Handle different input types
        if hasattr(self._zip_file, 'read'):
            # File-like object - need to read into BytesIO for ZipFile
            content = self._zip_file.read()
            self._zf = zipfile.ZipFile(BytesIO(content), 'r')
        else:
            # Assume path string
            self._zf = zipfile.ZipFile(self._zip_file, 'r')
        
        # Build lightweight index (just filenames, no content extraction)
        self._build_index()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._zf:
            self._zf.close()
        return False
    
    def _build_index(self):
        """Build the filename index without extracting content."""
        import os
        
        for zip_info in self._zf.infolist():
            if zip_info.is_dir():
                continue
            
            filename = zip_info.filename
            base_name = os.path.basename(filename)
            name_without_ext, ext = os.path.splitext(base_name)
            ext_lower = ext.lower()
            
            if ext_lower not in self.VALID_EXTENSIONS:
                continue
            
            # Normalize for matching
            normalized_key = BaseService.normalize_image_identifier(name_without_ext)
            
            if normalized_key:
                self._index[normalized_key] = zip_info
                self._raw_index[normalized_key] = {
                    'ext': ext_lower,
                    'original_name': base_name,
                    'zip_filename': filename
                }
    
    def __contains__(self, key: str) -> bool:
        """Check if a normalized key exists in the index."""
        normalized = BaseService.normalize_image_identifier(key) if key else None
        return normalized in self._index if normalized else False
    
    def keys(self):
        """Get all normalized keys."""
        return self._index.keys()
    
    def get_photo(self, key: str, validate: bool = True) -> Optional[Dict]:
        """
        Extract and return photo data for a key.
        
        Args:
            key: Identifier to lookup (will be normalized)
            validate: Whether to validate the image bytes
            
        Returns:
            Dict with {bytes, ext, original_name} or None if not found/invalid
        """
        from ..services.image_service import ImageService
        
        normalized = BaseService.normalize_image_identifier(key) if key else None
        if not normalized or normalized not in self._index:
            return None
        
        zip_info = self._index[normalized]
        raw_info = self._raw_index[normalized]
        
        try:
            image_bytes = self._zf.read(zip_info.filename)
            
            if validate:
                is_valid, error_msg = ImageService.validate_image_bytes(image_bytes)
                if not is_valid:
                    return None
            
            return {
                'bytes': image_bytes,
                'ext': raw_info['ext'],
                'original_name': raw_info['original_name']
            }
        except Exception:
            return None
    
    def get_info(self, key: str) -> Optional[Dict]:
        """
        Get metadata about a photo without extracting bytes.
        
        Returns:
            Dict with {ext, original_name, zip_filename} or None
        """
        normalized = BaseService.normalize_image_identifier(key) if key else None
        if not normalized or normalized not in self._raw_index:
            return None
        return self._raw_index[normalized].copy()
