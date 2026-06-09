def simulate_update(data, current_table_ids):
    scopes_raw = data.get('assignment_scopes')
    normalized_assignment_scopes = scopes_raw if isinstance(scopes_raw, list) else None
    
    scope_group_ids = sorted({
        int(scope.get('group_id', 0) or 0)
        for scope in (normalized_assignment_scopes or [])
        if int(scope.get('group_id', 0) or 0) > 0
    })
    scope_table_ids = sorted({
        int(scope.get('scope_id', 0) or 0)
        for scope in (normalized_assignment_scopes or [])
        if str(scope.get('scope_type', '')).lower() == 'table' and int(scope.get('scope_id', 0) or 0) > 0
    })

    resolved_group_ids = []
    resolved_table_ids = current_table_ids.copy()
    
    def _resolve(assignment_ids):
        # mock resolve
        return assignment_ids, assignment_ids

    if ('assigned_groups' in data) or (normalized_assignment_scopes is not None):
        explicit_assignment_payload = 'assigned_groups' in data
        assignment_ids = data.get('assigned_groups', [])
        
        if explicit_assignment_payload:
            if not assignment_ids and normalized_assignment_scopes:
                assignment_ids = scope_group_ids
                
            if assignment_ids:
                resolved_group_ids, resolved_table_ids = _resolve(assignment_ids)
            else:
                resolved_group_ids, resolved_table_ids = [], []

        if normalized_assignment_scopes:
            resolved_group_ids = sorted(set(resolved_group_ids) | set(scope_group_ids))
            resolved_table_ids = sorted(set(resolved_table_ids) | set(scope_table_ids))
            
    return resolved_table_ids

print("TEST 1:", simulate_update({'assigned_groups': [], 'assignment_scopes': [{'scope_type': 'table', 'scope_id': 17}]}, [16, 17]))
print("TEST 2:", simulate_update({'assigned_groups': [17]}, [16]))
print("TEST 3:", simulate_update({'assignment_scopes': [{'scope_type': 'table', 'scope_id': 17}]}, [16]))
print("TEST 4:", simulate_update({'assigned_groups': []}, [16]))
