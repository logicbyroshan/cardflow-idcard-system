# Step 2 Mail Merge Guide

## Purpose
This guide documents the dedicated Mail Merge panel in Step 2.
It covers text token replacement, field mapping, photo-field insertion, and auto-map behavior.

## Mail Merge Panel
The Mail Merge tab is separate from the Text tab.
It contains only data-binding actions:
- Toggle token preview
- Insert merge field
- Auto map fields
- Open mapping report
- Insert photo field

## Text Token Replacement
You can type merge tokens directly inside text content.
Supported token formats:
- {{field_name}}
- <<field_name>>
- [[field_name]]

Example:
Name: {{name}}

At generation time, tokens are resolved against the card row field data.
If a token value is missing, fallback text XXXXX is used.

## Field-Bound Text Elements
When a text element has a selected field binding:
- The field value is used as the primary rendered text
- Optional label prefix is applied when showLabel is enabled
- Label text also supports token replacement

## Photo Field Mapping
Use Insert Photo Field in Mail Merge tab to bind an image-compatible field.
When generating cards, image elements with a mapped field pull the image value from DB row data.
If no field is mapped, the static image src is used.

## Auto Map
Auto Map scans text elements and tries to map them to schema fields using:
- exact name/label match
- token-exact match
- fuzzy name/label heuristics

Ambiguous and unmatched cases are shown in the report modal.

## Notes
- Text content editing remains on-canvas by double-clicking text elements.
- Text style and geometry controls remain in the Text tab.
- Data-binding actions remain in the Mail Merge tab.
