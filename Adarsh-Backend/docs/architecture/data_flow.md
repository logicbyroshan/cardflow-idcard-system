# Data Flow Documentation

## Client Creation Flow
```mermaid
sequenceDiagram
    participant Admin
    participant API
    participant Policy
    participant OrgService
    participant OrgRepo
    participant DB
    
    Admin->>API: POST /api/v1/organizations/
    API->>Policy: Check CanCreateOrgPolicy
    Policy-->>API: Allow
    API->>OrgService: create_organization(DTO)
    OrgService->>OrgRepo: create(data)
    OrgRepo->>DB: INSERT INTO organizations
    DB-->>OrgRepo: Org Instance
    OrgRepo-->>OrgService: Org Instance
    OrgService-->>API: Org Created
    API-->>Admin: 201 Created
```
*Flows for Operator Assignment, Table Creation, Field Creation, and Card Creation follow this identical Request -> Policy -> Service -> Repository -> DB pattern.*\n