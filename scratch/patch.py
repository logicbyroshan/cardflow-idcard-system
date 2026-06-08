import re

with open('mobile_api/views.py', 'r', encoding='utf-8') as f:
    content = f.read()

start_idx = content.find('        group_options = {}')
end_idx = content.find('        # Fallback assignment modes')

original_block = content[start_idx:end_idx]

new_block = """        group_options = {}
        table_options = {}
        global_sections = set()
        
        group_class_counts = {}
        table_class_counts = {}
        global_class_counts = {}
        
        group_branch_counts = {}
        table_branch_counts = {}
        global_branch_counts = {}
        
        group_class_sections = {}
        table_class_sections = {}
        global_class_sections = {}
        
        # Build maps
        for card in cards:
            tid = card['table_id']
            fd = card['field_data']
            if not fd:
                continue
            
            class_f, section_f, branch_f = table_fields_meta.get(tid, (None, None, None))
            class_val = ''
            section_val = ''
            branch_val = ''
            
            if class_f:
                val = fd.get(class_f) or fd.get(class_f.upper()) or fd.get(class_f.lower())
                if val: class_val = str(val).strip()
            if section_f:
                val = fd.get(section_f) or fd.get(section_f.upper()) or fd.get(section_f.lower())
                if val: section_val = str(val).strip()
            if branch_f:
                val = fd.get(branch_f) or fd.get(branch_f.upper()) or fd.get(branch_f.lower())
                if val: branch_val = str(val).strip()
                
            gid = next((t['group_id'] for t in tables_data if t['id'] == tid), None)
            
            if gid:
                group_options.setdefault(gid, {'sections': set()})
                if section_val: group_options[gid]['sections'].add(section_val)
                
                if class_val:
                    group_class_counts.setdefault(gid, {}).setdefault(class_val, 0)
                    group_class_counts[gid][class_val] += 1
                    group_class_sections.setdefault(gid, {}).setdefault(class_val, set())
                    if section_val: group_class_sections[gid][class_val].add(section_val)
                    
                if branch_val:
                    group_branch_counts.setdefault(gid, {}).setdefault(branch_val, 0)
                    group_branch_counts[gid][branch_val] += 1
                
            table_options.setdefault(tid, {'sections': set()})
            if section_val: table_options[tid]['sections'].add(section_val)
            
            if class_val:
                table_class_counts.setdefault(tid, {}).setdefault(class_val, 0)
                table_class_counts[tid][class_val] += 1
                table_class_sections.setdefault(tid, {}).setdefault(class_val, set())
                if section_val: table_class_sections[tid][class_val].add(section_val)
                
            if branch_val:
                table_branch_counts.setdefault(tid, {}).setdefault(branch_val, 0)
                table_branch_counts[tid][branch_val] += 1
            
            if section_val: global_sections.add(section_val)
            
            if class_val:
                global_class_counts.setdefault(class_val, 0)
                global_class_counts[class_val] += 1
                global_class_sections.setdefault(class_val, set())
                if section_val: global_class_sections[class_val].add(section_val)
                
            if branch_val:
                global_branch_counts.setdefault(branch_val, 0)
                global_branch_counts[branch_val] += 1
                
        from core.utils.field_utils import normalize_class_value, normalize_compact_text_value, CLASS_ORDER, CLASS_ORDER_UNKNOWN
        from collections import defaultdict

        def resolve_normalized_options(counts_dict, normalizer):
            groups = defaultdict(list)
            for raw, count in counts_dict.items():
                canonical = normalizer(raw)
                if canonical:
                    groups[canonical].append((raw, count))
            
            raw_to_best = {}
            best_options = []
            for canonical, variants in groups.items():
                best_raw = max(variants, key=lambda x: x[1])[0]
                best_options.append(best_raw)
                for raw, _ in variants:
                    raw_to_best[raw] = best_raw
            return raw_to_best, best_options

        def sort_classes(classes_list):
            return sorted(classes_list, key=lambda x: (CLASS_ORDER.get(normalize_class_value(x), CLASS_ORDER_UNKNOWN), normalize_class_value(x)))

        group_options_json = {}
        for gid, opt in group_options.items():
            c_raw_to_best, c_best = resolve_normalized_options(group_class_counts.get(gid, {}), normalize_class_value)
            b_raw_to_best, b_best = resolve_normalized_options(group_branch_counts.get(gid, {}), normalize_compact_text_value)
            
            cls_secs = defaultdict(set)
            for c_raw, s_set in group_class_sections.get(gid, {}).items():
                best_cls = c_raw_to_best.get(c_raw, c_raw)
                cls_secs[best_cls].update(s_set)
                
            group_options_json[str(gid)] = {
                'classes': sort_classes(c_best),
                'sections': sorted(opt['sections']),
                'branches': sorted(b_best),
                'class_sections': {k: sorted(list(v)) for k, v in cls_secs.items()}
            }
            
        table_options_json = {}
        for tid, opt in table_options.items():
            c_raw_to_best, c_best = resolve_normalized_options(table_class_counts.get(tid, {}), normalize_class_value)
            b_raw_to_best, b_best = resolve_normalized_options(table_branch_counts.get(tid, {}), normalize_compact_text_value)
            
            cls_secs = defaultdict(set)
            for c_raw, s_set in table_class_sections.get(tid, {}).items():
                best_cls = c_raw_to_best.get(c_raw, c_raw)
                cls_secs[best_cls].update(s_set)
                
            table_options_json[str(tid)] = {
                'classes': sort_classes(c_best),
                'sections': sorted(opt['sections']),
                'branches': sorted(b_best),
                'class_sections': {k: sorted(list(v)) for k, v in cls_secs.items()}
            }
            
        glb_c_raw_to_best, glb_c_best = resolve_normalized_options(global_class_counts, normalize_class_value)
        glb_b_raw_to_best, glb_b_best = resolve_normalized_options(global_branch_counts, normalize_compact_text_value)
        
        glb_cls_secs = defaultdict(set)
        for c_raw, s_set in global_class_sections.items():
            best_cls = glb_c_raw_to_best.get(c_raw, c_raw)
            glb_cls_secs[best_cls].update(s_set)
            
        global_options = {
            'classes': sort_classes(glb_c_best),
            'sections': sorted(global_sections),
            'branches': sorted(glb_b_best),
            'class_sections': {k: sorted(list(v)) for k, v in glb_cls_secs.items()}
        }
        
"""

with open('mobile_api/views.py', 'w', encoding='utf-8') as f:
    f.write(content.replace(original_block, new_block))

print("Patch applied successfully.")
