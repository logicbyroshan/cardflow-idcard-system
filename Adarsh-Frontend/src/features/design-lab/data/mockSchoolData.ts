import type { StatusKey } from '@/constants/statuses'

export interface StudentRecord {
  id: string
  rollNumber: string
  name: string
  className: string
  section: string
  status: StatusKey
  createdAt: string
  bloodGroup: string
}

export interface StaffRecord {
  id: string
  staffId: string
  name: string
  department: string
  designation: string
  status: StatusKey
  joiningDate: string
}

export interface ReprintRecord {
  id: string
  studentName: string
  className: string
  section: string
  reason: string
  requestDate: string
  status: StatusKey
}

export interface WorkflowRecord {
  id: string
  taskName: string
  operator: string
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  status: StatusKey
  updatedAt: string
}

export const MOCK_STUDENTS: StudentRecord[] = [
  { id: "std-001", rollNumber: "101", name: "Aarav Sharma", className: "Class X", section: "Section A", status: "APPROVED", createdAt: "2026-05-15", bloodGroup: "O+" },
  { id: "std-002", rollNumber: "102", name: "Aditi Rao", className: "Class X", section: "Section B", status: "VERIFIED", createdAt: "2026-05-18", bloodGroup: "A+" },
  { id: "std-003", rollNumber: "103", name: "Vihaan Gupta", className: "Class IX", section: "Section A", status: "PENDING", createdAt: "2026-05-20", bloodGroup: "B+" },
  { id: "std-004", rollNumber: "104", name: "Meera Nair", className: "Class XII", section: "Section C", status: "DOWNLOADED", createdAt: "2026-05-22", bloodGroup: "AB+" },
  { id: "std-005", rollNumber: "105", name: "Reyansh Singh", className: "Class XI", section: "Section B", status: "REJECTED", createdAt: "2026-05-23", bloodGroup: "O-" },
  { id: "std-006", rollNumber: "106", name: "Ananya Iyer", className: "Class X", section: "Section A", status: "PRINTED", createdAt: "2026-05-24", bloodGroup: "A-" },
  { id: "std-007", rollNumber: "107", name: "Kabir Verma", className: "Class VIII", section: "Section B", status: "CONFIRMED", createdAt: "2026-05-25", bloodGroup: "B-" },
  { id: "std-008", rollNumber: "108", name: "Ishaan Mehta", className: "Class IX", section: "Section A", status: "REQUESTED", createdAt: "2026-05-26", bloodGroup: "O+" },
  { id: "std-009", rollNumber: "109", name: "Diya Patel", className: "Class XII", section: "Section A", status: "DELETED", createdAt: "2026-05-27", bloodGroup: "AB-" },
  { id: "std-010", rollNumber: "110", name: "Sai Krishna", className: "Class XI", section: "Section C", status: "APPROVED", createdAt: "2026-05-28", bloodGroup: "A+" }
]

export const MOCK_STAFF: StaffRecord[] = [
  { id: "stf-001", staffId: "EMP-204", name: "Dr. Ramesh Kumar", department: "Science", designation: "HOD Physics", status: "APPROVED", joiningDate: "2018-06-01" },
  { id: "stf-002", staffId: "EMP-205", name: "Sunita Deshmukh", department: "Mathematics", designation: "Senior Teacher", status: "VERIFIED", joiningDate: "2020-09-15" },
  { id: "stf-003", staffId: "EMP-206", name: "Amit Trivedi", department: "Administration", designation: "Registrar", status: "PENDING", joiningDate: "2021-02-10" },
  { id: "stf-004", staffId: "EMP-207", name: "Priya Fernandez", department: "Languages", designation: "English Faculty", status: "PRINTED", joiningDate: "2022-07-20" },
  { id: "stf-005", staffId: "EMP-208", name: "Suresh Pillai", department: "IT Support", designation: "Systems Admin", status: "REJECTED", joiningDate: "2023-01-05" }
]

export const MOCK_REPRINTS: ReprintRecord[] = [
  { id: "rep-001", studentName: "Rohan Das", className: "Class X", section: "A", reason: "Lost card in transport bus", requestDate: "2026-06-01", status: "REQUESTED" },
  { id: "rep-002", studentName: "Tanya Sen", className: "Class XII", section: "B", reason: "Card chip malfunctioned", requestDate: "2026-06-02", status: "CONFIRMED" },
  { id: "rep-003", studentName: "Arjun Bhatia", className: "Class IX", section: "C", reason: "Class promotion section shift", requestDate: "2026-06-03", status: "PENDING" },
  { id: "rep-004", studentName: "Sanya Malik", className: "Class VIII", section: "A", reason: "Spelled name incorrectly", requestDate: "2026-06-04", status: "PRINTED" },
  { id: "rep-005", studentName: "Manish Joshi", className: "Class XI", section: "B", reason: "Card snapped in half", requestDate: "2026-06-05", status: "REJECTED" }
]

export const MOCK_WORKFLOWS: WorkflowRecord[] = [
  { id: "wf-001", taskName: "Batch Card Approval (120 cards)", operator: "System Administrator", priority: "HIGH", status: "APPROVED", updatedAt: "2026-06-08 14:30" },
  { id: "wf-002", taskName: "Client Sync Pipeline Validation", operator: "Operator 12", priority: "MEDIUM", status: "VERIFIED", updatedAt: "2026-06-08 15:45" },
  { id: "wf-003", taskName: "Reprint Queue Audit", operator: "Principal Staff", priority: "LOW", status: "PENDING", updatedAt: "2026-06-09 09:15" },
  { id: "wf-004", taskName: "MinIO Storage Sync Check", operator: "Cron Job Daemon", priority: "HIGH", status: "CONFIRMED", updatedAt: "2026-06-09 10:00" },
  { id: "wf-005", taskName: "Bulk CSV Roll number update", operator: "Class Teacher XII", priority: "MEDIUM", status: "DOWNLOADED", updatedAt: "2026-06-09 11:20" }
]
