"""
Export Services Module

Main orchestration layer for all export operations.
This module is READ-ONLY - it never mutates data.

Features:
- Permission checking integration
- Client scoping for admin staff
- Delegates to specialized exporters (excel, word, zip)
- Clean interface for views
"""
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404

from core.models import IDCardTable, IDCard
from core.services.permission_service import PermissionService

from .excel import ExcelExporter, ExcelExportResult
from .word import WordExporter, WordExportResult
from .pdf import PdfExporter, PdfExportResult
from .zip import ZipExporter, ZipExportResult
from .utils import get_text_fields, get_image_fields


@dataclass
class ExportContext:
    """
    Context for an export operation.
    
    Contains user, table, and scoped cards based on permissions.
    """
    user: Any
    table: IDCardTable
    cards: QuerySet
    has_permission: bool = True
    error_message: str = ''


class ExportService:
    """
    Main service for export operations.
    
    Responsibilities:
    - Permission checking
    - Client scoping
    - Delegating to specialized exporters
    
    Usage:
        service = ExportService(request.user)
        
        # Excel export
        result = service.export_excel(table_id, card_ids)
        if result.success:
            return result.response
        
        # Word export
        result = service.export_word(table_id, card_ids)
        if result.success:
            return result.response
        
        # Image ZIP export  
        result = service.export_images(table_id, card_ids)
        if result.success:
            return JsonResponse(zip_result_to_dict(result))
    """
    
    def __init__(self, user):
        self.user = user
        self._excel_exporter = ExcelExporter()
        self._word_exporter = WordExporter()
        self._pdf_exporter = PdfExporter()
        self._zip_exporter = ZipExporter()
    
    # =========================================================================
    # PERMISSION & SCOPING
    # =========================================================================
    
    def can_export(self) -> bool:
        """Check if user has permission to export (bulk download)."""
        return PermissionService.can_bulk_download(self.user)
    
    def can_view_download_list(self) -> bool:
        """Check if user can view download list."""
        return PermissionService.has(self.user, 'perm_idcard_download_list')
    
    def get_scoped_cards(
        self,
        table: IDCardTable,
        card_ids: Optional[List[int]] = None
    ) -> QuerySet:
        """
        Get cards scoped to user's access level.
        Delegates role-based filtering to PermissionService.
        Safety cap of 5000 records when no card_ids provided.
        """
        MAX_EXPORT_CARDS = 5000
        # Base queryset
        if card_ids:
            cards = IDCard.objects.filter(table=table, id__in=card_ids[:MAX_EXPORT_CARDS])
        else:
            cards = IDCard.objects.filter(table=table)
        
        # Super admin sees all
        if PermissionService.is_super_admin(self.user):
            return cards.order_by('-id')
        
        # Apply client scoping for admin staff
        if PermissionService.is_admin_staff(self.user):
            accessible_ids = PermissionService.get_accessible_client_ids(self.user)
            cards = cards.filter(table__group__client_id__in=accessible_ids)
        
        # For client users, scope to their own client
        elif PermissionService.is_client(self.user):
            client = getattr(self.user, 'client_profile', None)
            if client:
                cards = cards.filter(table__group__client=client)
            else:
                cards = cards.none()
        
        # For client staff, scope to their client
        elif PermissionService.is_client_staff(self.user):
            staff = getattr(self.user, 'staff_profile', None)
            if staff and staff.client:
                cards = cards.filter(table__group__client=staff.client)
            else:
                cards = cards.none()
        
        else:
            cards = cards.none()
        
        result = cards.order_by('-id')
        # Safety cap when no specific card_ids provided
        if not card_ids:
            result = result[:MAX_EXPORT_CARDS]
        return result
    
    def _prepare_context(
        self,
        table_id: int,
        card_ids: Optional[List[int]] = None,
        require_export_permission: bool = True
    ) -> ExportContext:
        """
        Prepare export context with permissions and scoping.
        
        Args:
            table_id: ID of the table
            card_ids: Optional list of card IDs
            require_export_permission: Whether to check bulk download permission
            
        Returns:
            ExportContext with scoped cards or error
        """
        # Check permission if required
        if require_export_permission and not self.can_export():
            return ExportContext(
                user=self.user,
                table=None,
                cards=IDCard.objects.none(),
                has_permission=False,
                error_message='Permission denied: You do not have export access'
            )
        
        try:
            table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
        except Exception:
            return ExportContext(
                user=self.user,
                table=None,
                cards=IDCard.objects.none(),
                has_permission=False,
                error_message=f'Table not found: {table_id}'
            )
        
        # Get scoped cards
        cards = self.get_scoped_cards(table, card_ids)
        
        if not cards.exists():
            return ExportContext(
                user=self.user,
                table=table,
                cards=cards,
                has_permission=True,
                error_message='No cards available for export'
            )
        
        return ExportContext(
            user=self.user,
            table=table,
            cards=cards,
            has_permission=True
        )
    
    # =========================================================================
    # EXCEL EXPORT
    # =========================================================================
    
    def export_excel(
        self,
        table_id: int,
        card_ids: Optional[List[int]] = None,
        status: str = ''
    ) -> ExcelExportResult:
        """
        Export cards to Excel format.
        
        Args:
            table_id: ID of the table to export
            card_ids: Optional list of specific card IDs
            status: Current status tab label
            
        Returns:
            ExcelExportResult with HttpResponse if successful
        """
        context = self._prepare_context(table_id, card_ids)
        
        if not context.has_permission or context.error_message:
            return ExcelExportResult(
                success=False,
                message=context.error_message or 'Permission denied'
            )
        
        return self._excel_exporter.export_cards(context.table, context.cards, status=status)
    
    # =========================================================================
    # WORD EXPORT
    # =========================================================================
    
    def export_word(
        self,
        table_id: int,
        card_ids: Optional[List[int]] = None,
        doc_format: str = 'docx',
        status: str = ''
    ) -> WordExportResult:
        """
        Export cards to Word format.
        
        Args:
            table_id: ID of the table to export
            card_ids: Optional list of specific card IDs
            doc_format: 'docx' or 'doc'
            status: Current status tab label
            
        Returns:
            WordExportResult with HttpResponse if successful
        """
        context = self._prepare_context(table_id, card_ids)
        
        if not context.has_permission or context.error_message:
            return WordExportResult(
                success=False,
                message=context.error_message or 'Permission denied'
            )
        
        return self._word_exporter.export_cards(
            context.table, context.cards, doc_format=doc_format, status=status
        )
    
    # =========================================================================
    # PDF EXPORT
    # =========================================================================
    
    def export_pdf(
        self,
        table_id: int,
        card_ids: Optional[List[int]] = None,
        status: str = ''
    ) -> PdfExportResult:
        """
        Export cards to PDF format.
        
        Args:
            table_id: ID of the table to export
            card_ids: Optional list of specific card IDs
            status: Current status tab label
            
        Returns:
            PdfExportResult with HttpResponse if successful
        """
        context = self._prepare_context(table_id, card_ids)
        
        if not context.has_permission or context.error_message:
            return PdfExportResult(
                success=False,
                message=context.error_message or 'Permission denied'
            )
        
        return self._pdf_exporter.export_cards(context.table, context.cards, status=status)
    
    # =========================================================================
    # IMAGE ZIP EXPORT
    # =========================================================================
    
    def export_images(
        self,
        table_id: int,
        card_ids: Optional[List[int]] = None,
        status: str = ''
    ) -> ZipExportResult:
        """
        Export images as ZIP files (one per image field).
        
        Args:
            table_id: ID of the table to export
            card_ids: Optional list of specific card IDs
            status: Current status tab label
            
        Returns:
            ZipExportResult with base64-encoded ZIP files
        """
        context = self._prepare_context(table_id, card_ids)
        
        if not context.has_permission or context.error_message:
            return ZipExportResult(
                success=False,
                message=context.error_message or 'Permission denied'
            )
        
        return self._zip_exporter.export_images(context.table, context.cards, status=status)
    
    # =========================================================================
    # COMBINED EXPORT (for download list page)
    # =========================================================================
    
    def get_export_preview(
        self,
        table_id: int,
        card_ids: Optional[List[int]] = None
    ) -> Dict[str, Any]:
        """
        Get preview information for export (counts, available formats).
        
        Args:
            table_id: ID of the table
            card_ids: Optional list of specific card IDs
            
        Returns:
            Dictionary with export information
        """
        context = self._prepare_context(table_id, card_ids, require_export_permission=False)
        
        if not context.has_permission or context.error_message:
            return {
                'success': False,
                'message': context.error_message or 'Permission denied'
            }
        
        card_count = context.cards.count()
        text_fields = get_text_fields(context.table.fields or [])
        image_fields = get_image_fields(context.table.fields or [])
        
        return {
            'success': True,
            'table_name': context.table.name,
            'card_count': card_count,
            'text_field_count': len(text_fields),
            'image_field_count': len(image_fields),
            'available_formats': {
                'xlsx': len(text_fields) > 0,
                'docx': True,
                'doc': True,
                'zip': len(image_fields) > 0
            },
            'can_export': self.can_export()
        }


# =============================================================================
# MODULE-LEVEL CONVENIENCE FUNCTIONS
# =============================================================================

def create_export_service(user) -> ExportService:
    """
    Create an ExportService instance for a user.
    
    Args:
        user: Django user instance
        
    Returns:
        ExportService configured for the user
    """
    return ExportService(user)


def export_xlsx(user, table_id: int, card_ids: List[int]) -> ExcelExportResult:
    """
    Convenience function to export cards to Excel.
    
    Args:
        user: Django user instance
        table_id: ID of the table
        card_ids: List of card IDs
        
    Returns:
        ExcelExportResult
    """
    service = ExportService(user)
    return service.export_excel(table_id, card_ids)


def export_docx(user, table_id: int, card_ids: List[int], doc_format: str = 'docx') -> WordExportResult:
    """
    Convenience function to export cards to Word.
    
    Args:
        user: Django user instance
        table_id: ID of the table
        card_ids: List of card IDs
        doc_format: 'docx' or 'doc'
        
    Returns:
        WordExportResult
    """
    service = ExportService(user)
    return service.export_word(table_id, card_ids, doc_format=doc_format)


def export_zip(user, table_id: int, card_ids: List[int]) -> ZipExportResult:
    """
    Convenience function to export images as ZIP.
    
    Args:
        user: Django user instance
        table_id: ID of the table
        card_ids: List of card IDs
        
    Returns:
        ZipExportResult
    """
    service = ExportService(user)
    return service.export_images(table_id, card_ids)


def export_pdf(user, table_id: int, card_ids: List[int]) -> PdfExportResult:
    """
    Convenience function to export cards as PDF.
    
    Args:
        user: Django user instance
        table_id: ID of the table
        card_ids: List of card IDs
        
    Returns:
        PdfExportResult
    """
    service = ExportService(user)
    return service.export_pdf(table_id, card_ids)
