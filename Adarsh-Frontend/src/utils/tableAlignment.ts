/**
 * Table Alignment System
 * Automatically determines alignment based on column headers and keys.
 */

const CENTERED_KEYS = [
  'class', 'section', 'gender', 'status', 'date', 'time', 'roll', 'phone', 'count', 'number', 'id', 'code'
]

const LEFT_ALIGNED_KEYS = [
  'name', 'address', 'description', 'remarks', 'organization', 'client', 'text', 'workspace'
]

export function getColumnAlignment(columnId: string, headerText?: string): 'center' | 'left' {
  const normalizedId = columnId.toLowerCase();
  const normalizedHeader = headerText?.toLowerCase() || '';

  // Check if any centered keys are present in ID or Header
  if (CENTERED_KEYS.some(key => normalizedId.includes(key) || normalizedHeader.includes(key))) {
    return 'center';
  }
  
  // Check if any left-aligned keys are present
  if (LEFT_ALIGNED_KEYS.some(key => normalizedId.includes(key) || normalizedHeader.includes(key))) {
    return 'left';
  }

  // Default fallback alignment
  return 'left';
}
