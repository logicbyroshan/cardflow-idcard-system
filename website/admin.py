from django.contrib import admin
from django.utils.html import format_html
from .models import (
    BusinessDetails, Feature, PortfolioCategory, PortfolioItem, 
    Testimonial, ContactSubmission, FAQ, 
    WebsiteStatus,
)

# --- Helper Function for Image Previews ---
def image_preview(obj_image_field):
    if obj_image_field:
        return format_html('<img src="{}" style="width: 50px; height: auto; border-radius: 4px;" />', obj_image_field.url)
    return "No Image"


@admin.register(BusinessDetails)
class BusinessDetailsAdmin(admin.ModelAdmin):
    """
    Admin configuration for Global Site Info.
    Restricts creation of multiple instances (Singleton).
    """
    fieldsets = (
        ('Site Branding', {
            'fields': ('site_name', 'tagline')
        }),
        ('Contact Information', {
            'fields': ('email', ('phone1', 'phone2'), 'address')
        }),
        ('Social Media', {
            'fields': ('facebook_url', 'instagram_url', 'linkedin_url', 'youtube_url'),
        }),

    )

    def has_add_permission(self, request):
        # If an instance already exists, don't allow adding another
        if self.model.objects.exists():
            return False
        return super().has_add_permission(request)


@admin.register(Feature)
class FeatureAdmin(admin.ModelAdmin):
    list_display = ('order', 'title', 'icon_preview', 'number', 'is_featured', 'is_active')
    list_display_links = ('title',)
    list_editable = ('order', 'is_active', 'is_featured')
    search_fields = ('title', 'description')
    list_filter = ('is_active', 'is_featured')

    def icon_preview(self, obj):
        return format_html('<i class="{}" style="font-size: 1.2rem;"></i>', obj.icon)
    icon_preview.short_description = 'Icon'


@admin.register(PortfolioCategory)
class PortfolioCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'icon', 'is_default', 'order', 'is_active', 'created_at')
    list_editable = ('order', 'is_active')
    search_fields = ('name',)
    list_filter = ('is_active', 'is_default')
    prepopulated_fields = {'slug': ('name',)}
    ordering = ('order', 'name')

    ordering = ('order', 'name')


@admin.register(PortfolioItem)
class PortfolioItemAdmin(admin.ModelAdmin):
    list_display = ('thumbnail', 'title', 'category', 'item_type', 'orientation', 'is_featured', 'is_active', 'order')
    list_filter = ('category', 'item_type', 'orientation', 'is_featured', 'is_active')
    search_fields = ('title', 'description')
    prepopulated_fields = {'slug': ('title',)}
    list_editable = ('order', 'is_active', 'is_featured', 'category')
    
    def thumbnail(self, obj):
        return image_preview(obj.image)
    thumbnail.short_description = 'Preview'



@admin.register(Testimonial)
class TestimonialAdmin(admin.ModelAdmin):
    list_display = ('reviewer_name', 'reviewer_school', 'rating_display', 'review_date', 'is_active')
    list_filter = ('rating', 'is_active', 'review_date')
    search_fields = ('reviewer_name', 'reviewer_email', 'reviewer_school', 'text')
    date_hierarchy = 'review_date'
    
    fieldsets = (
        ('Reviewer Info', {
            'fields': (('reviewer_name', 'reviewer_title'), 'reviewer_email', 'reviewer_school', 'reviewer_avatar')
        }),
        ('Review Content', {
            'fields': ('rating', 'tag', 'text', 'review_date', 'helpful_count')
        }),
        ('Status', {
            'fields': ('is_active',)
        }),
    )

    def rating_display(self, obj):
        stars = '⭐' * obj.rating
        return stars
    rating_display.short_description = 'Rating'


@admin.register(ContactSubmission)
class ContactSubmissionAdmin(admin.ModelAdmin):
    list_display = ('name', 'subject', 'status_colored', 'email_status', 'created_at')
    list_filter = ('status', 'email_status', 'created_at')
    search_fields = ('name', 'email', 'subject', 'message')
    readonly_fields = ('created_at', 'updated_at', 'email_retry_count', 'email_last_attempt', 'email_sent_at')
    
    fieldsets = (
        ('Lead Information', {
            'fields': (('name', 'email'), 'phone', 'subject', 'message')
        }),
        ('Management', {
            'fields': ('status', 'created_at')
        }),
        ('Email Tracking Logs', {
            'classes': ('collapse',),
            'fields': ('email_status', 'email_retry_count', 'email_last_attempt', 'email_sent_at'),
        }),
    )

    def status_colored(self, obj):
        colors = {
            'new': '#d9534f',      # Red
            'read': '#f0ad4e',     # Orange
            'replied': '#5bc0de',  # Blue
            'closed': '#5cb85c',   # Green
        }
        return format_html(
            '<span style="background-color: {}; color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">{}</span>',
            colors.get(obj.status, '#ccc'),
            obj.get_status_display()
        )
    status_colored.short_description = 'Status'


@admin.register(FAQ)
class FAQAdmin(admin.ModelAdmin):
    list_display = ('question_short', 'order', 'is_active', 'created_at')
    list_editable = ('order', 'is_active')
    search_fields = ('question', 'answer')
    list_filter = ('is_active',)
    ordering = ('order',)

    def question_short(self, obj):
        return obj.question[:60] + '...' if len(obj.question) > 60 else obj.question
    question_short.short_description = 'Question'


# --- New models added in Phase 2 ---

@admin.register(WebsiteStatus)
class WebsiteStatusAdmin(admin.ModelAdmin):
    """Singleton: Live / Draft toggle for the public website."""
    list_display = ('status', 'updated_at')
    readonly_fields = ('updated_at',)

    def has_add_permission(self, request):
        if self.model.objects.exists():
            return False
        return super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        return False



