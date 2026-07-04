class ExportType:
    PDF = 'PDF'
    DOCX = 'DOCX'
    XLSX = 'XLSX'
    ZIP = 'ZIP'

class ExportStatus:
    PENDING = 'PENDING'
    PROCESSING = 'PROCESSING'
    COMPLETED = 'COMPLETED'
    FAILED = 'FAILED'
    PARTIAL = 'PARTIAL'

class PageBreak:
    NONE = 'NONE'
    BY_CLASS = 'BY_CLASS'
    BY_SECTION = 'BY_SECTION'

class XlsxFieldScope:
    ALL = 'ALL'
    VISIBLE = 'VISIBLE'

class ExportScope:
    SELECTED = 'SELECTED'
    FILTERED = 'FILTERED'
    ALL = 'ALL'
