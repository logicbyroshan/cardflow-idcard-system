# User Hierarchy Documentation

```mermaid
graph TD
    PRO[PRO_USER] --> ADM[ADMIN]
    PRO -.->|Impersonates| ADM
    
    ADM --> OP[OPERATOR]
    ADM --> CLI[CLIENT]
    
    OP --> CLI
    
    CLI --> AST[ASSISTANT]
    CLI --> GST[GUEST]
    
    AST -->|Manages Cards| Cards[(Cards)]
```

### Hierarchy Rules
1. **PRO_USER**: Superuser. Maintains infrastructure. Can impersonate anyone.
2. **ADMIN**: Tenant Owner. Full control over an Organization.
3. **OPERATOR**: Staff. Manages Clients on behalf of the Admin.
4. **CLIENT**: Customer. Owns Tables and workflows.
5. **ASSISTANT**: Data entry worker. Can only edit assigned cards.
6. **GUEST**: Read-only tracking access.\n