"""
Surgical patch of idcard-actions.min.js to use normalized field name lookup.
This avoids editing the minified bundle as a whole text block.
"""

BUNDLE = 'static/dist/js/idcard-actions.min.js'

with open(BUNDLE, 'r', encoding='utf-8') as f:
    c = f.read()

original_size = len(c)

# ── PATCH 1 ─────────────────────────────────────────────────────────────────
# Replace positional forEach that sets fieldMap with exact name keys
# Old:
#   card.ordered_fields.forEach(f=>fieldMap.set(f.name,f));
# New (normalized key + also seed fieldData):
OLD1 = 'card.ordered_fields.forEach(f=>fieldMap.set(f.name,f));'
NEW1 = (
    "const normKey=(n)=>n?String(n).toUpperCase().replace(/[^A-Z0-9]/g,''):'';"
    "const fieldData=card.field_data||{};"
    "card.ordered_fields.forEach(f=>{if(f&&f.name)fieldMap.set(normKey(f.name),f);});"
    "for(const fk in fieldData){const fnk=normKey(fk);"
    "if(!fieldMap.has(fnk))fieldMap.set(fnk,{name:fk,type:'text',value:fieldData[fk]});}"
)
if OLD1 not in c:
    print('ERROR: PATCH1 anchor not found')
else:
    c = c.replace(OLD1, NEW1, 1)
    print('OK: PATCH1 applied')

# ── PATCH 2 ─────────────────────────────────────────────────────────────────
# Replace exact-name fieldMap lookup with normalized-key lookup
OLD2 = 'const fname=th.dataset.fieldName;if(!fname)return;if(fieldMap.has(fname)){syncFields.push(fieldMap.get(fname));}'
NEW2 = (
    "const fname=th.dataset.fieldName;if(!fname)return;"
    "const fKey=normKey(fname);"
    "if(fieldMap.has(fKey)){const mf=fieldMap.get(fKey);"
    "syncFields.push({name:fname,type:th.dataset.fieldType||mf.type||'text',"
    "value:(mf.value!==undefined&&mf.value!==null)?mf.value:''});}"
)
if OLD2 not in c:
    print('ERROR: PATCH2 anchor not found')
else:
    c = c.replace(OLD2, NEW2, 1)
    print('OK: PATCH2 applied')

# ── PATCH 3 ─────────────────────────────────────────────────────────────────
# Replace case-insensitive for..of loop with direct baseKey lookup
OLD3 = "for(const[k,photoObj]of fieldMap.entries()){if(k.toLowerCase()===basePhotoName.toLowerCase()){let photoVal=photoObj?(photoObj.value||''):'';"
NEW3 = "const baseKey=normKey(basePhotoName);if(fieldMap.has(baseKey)){let photoVal=fieldMap.get(baseKey).value||'';"
if OLD3 not in c:
    print('ERROR: PATCH3 anchor not found')
else:
    c = c.replace(OLD3, NEW3, 1)
    print('OK: PATCH3 applied')

# ── PATCH 4 ─────────────────────────────────────────────────────────────────
# Replace the loop's closing "break;}}}" with just "}}"
# Original ends with:  ...pathVal=idxDot!==-1?filename.substring(0,idxDot):filename;}break;}}}
# After patch 3:       ...pathVal=idxDot!==-1?filename.substring(0,idxDot):filename;}}
# The loop's "break;}}}" is now "}}}" which we need to become "}}"
OLD4 = "filename.lastIndexOf('.');pathVal=idxDot!==-1?filename.substring(0,idxDot):filename;}break;}}}"
NEW4 = "filename.lastIndexOf('.');pathVal=idxDot!==-1?filename.substring(0,idxDot):filename;}}}"
# Note: after patch3 the for loop is gone so there's no break or extra }
# The original structure after removing old3 is:
#   ...filename.substring(0,idxDot):filename;} break;}}} syncFields.push...
# After our new3 replacement, the 'if(fieldMap.has(baseKey)){' provides one {
# and the inner if(photoVal){ provides another. We close both with }}
# But OLD4 has 3 closing braces — that's: close photoVal-if, close for-loop-if, close for loop
# After our patch the for loop is gone; we need: close photoVal-if, close fieldMap-if
# So OLD4: ...filename;}break;}}}  -> NEW4: ...filename;}}}  (drop the break and one })

# Check what's actually there after patches
if OLD4 in c:
    c = c.replace(OLD4, NEW4, 1)
    print('OK: PATCH4 (break removal) applied')
else:
    # Maybe break already gone — check alternate
    OLD4b = "filename.lastIndexOf('.');pathVal=idxDot!==-1?filename.substring(0,idxDot):filename;}}}"
    if OLD4b in c:
        print('SKIP: PATCH4 - break already absent, closing braces look correct')
    else:
        # Print surrounding context for debugging
        idx = c.find("pathVal=idxDot")
        if idx >= 0:
            print('CONTEXT around pathVal:', repr(c[idx:idx+120]))
        else:
            print('ERROR: PATCH4 - cannot locate pathVal region')

new_size = len(c)
print(f'Size change: {original_size} -> {new_size} (+{new_size - original_size})')

with open(BUNDLE, 'w', encoding='utf-8') as f:
    f.write(c)

print('Bundle patched and saved.')
