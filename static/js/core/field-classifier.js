/**
 * Field Classifier  Shared semantic field-type detection and validation.
 *
 * Maps arbitrary user-given column names to canonical semantic categories
 * (phone, email, name, address, date, blood_group, etc.) using regex patterns.
 * Mirrors the Python classify_column() in exports/column_spec.py.
 *
 * Usage:
 *   FieldClassifier.classify('FATHER MOBILE', 'text')    'phone'
 *   FieldClassifier.classify('DOB', 'text')               'date'
 *   FieldClassifier.validate('EMAIL', 'text', 'abc')      { valid: false, message: '' }
 *
 * @global {Object} window.FieldClassifier
 */
(function () {
'use strict';

var FC = {};

//  Normalise field name (strip separators, collapse spaces, lowercase) 
function _norm(name) {
    if (!name) return '';
    return name.trim()
        .replace(/[_.\-'"()\/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Classify a field name + type into a canonical semantic category.
 *
 * Categories returned:
 *   sr_no, blood_group, age, gender, relationship, class_section,
 *   date, phone, emergency_phone, email, id_number, name, address, address_sub,
 *   pincode, short_text, org_text, image, text (default)
 */
FC.classify = function (fieldName, fieldType) {
    var t = (fieldType || '').toLowerCase().trim();

    //  Explicit type shortcuts 
    if (t === 'date')                                         return 'date';
    if (t === 'textarea')                                     return 'address';
    if (t === 'email')                                        return 'email';
    if (['photo','rel_photo','image','mother_photo','father_photo',
         'signature','barcode','qr_code','qr','file'].indexOf(t) >= 0) return 'image';

    var n = _norm(fieldName);
    if (!n) return 'text';

    //  Serial / row 
    if (/^sr\s*no|^s\s*no|^sl\s*no|^serial|^sno$|^slno$/.test(n)) return 'sr_no';

    //  Blood Group (before name patterns) 
    if (/blo?o?d\s*gr|blo?o?d\s*gro?u?p|^bg$|^bgroup$|^b\.?g\.?$|^bld\s*gr|^blud|^blod|blo+d\s*grp|b\s*grp/.test(n)) return 'blood_group';

    //  Age 
    if (/^age$|^umar$/.test(n)) return 'age';

    //  Gender 
    if (/^gender$|^gen\s*der$|^sex$|^gndr$|^gendr$/.test(n)) return 'gender';

    //  Relationship 
    if (/^rel\s*\d*$|^relati?v|^relati?o?n/.test(n)) return 'relationship';

    //  Class / Section / House 
    if (/class.*sec|^class$|^section$|^sec$|^div$|^division$|^cls$|school\s*house|house\s*nam|house\s*col/.test(n)) return 'class_section';

    //  Dates 
    if (/d\.?\s*o\.?\s*b\.?|date\s*of\s*birth|birth\s*date|b\.?date/.test(n)) return 'date';
    if (/date\s*of\s*join|join(ing)?\s*date|d\.?o\.?j\.?|join\s*dt/.test(n)) return 'date';
    if (/valid\s*(from|till|upto)|validity|expiry|expire/.test(n))            return 'date';
    if (/\bdate\b|\bdt\b/.test(n))                                           return 'date';

    //  Parent/guardian phone (BEFORE name patterns) 
    if (/(?:father|mother|guardian|parent|mama|nana|dada|nani|dadi)\s*(?:no\.?|num|mob|ph(?:one)?|cell|tel|contact)/.test(n)) return 'phone';

    //  Driver phone 
    if (/driver\s*(?:no\b|numb?\w*|mob|pho?ne?|cell|contact|tel)/.test(n)) return 'phone';

    //  Emergency Contact (abbrev + full forms)
    if (/emerg(?:ency)?\s*cont(?:act)?\s*(?:no\.?|num(?:ber)?|mob(?:ile)?|pho?ne?|tel|cell)?/.test(n)) return 'emergency_phone';

    //  Phone / Mobile 
    if (/mobi?le?|pho?ne?|cell\b|tel\b|whatsapp|^mob\b|^ph\b|fone|contact\s*no|contact\s*num|emergency\s*contact\s*num|office\s*contact|alternate\s*mob|alt\s*mob/.test(n)) return 'phone';

    //  Email 
    if (/e?\s*mail|mail\s*id/.test(n)) return 'email';

    //  ID Documents 
    if (/a+dh?a+r|a+dhr|uidai|uid\s*no/.test(n))                                    return 'id_number';
    if (/^p[ae]n$|p[ae]n\s*no|p[ae]n\s*num|p[ae]n\s*card/.test(n))                    return 'id_number';
    if (/voter\s*id|epic\s*no|votr/.test(n))                                          return 'id_number';
    if (/driv\w*\s*li[cs]?en[cs]?e?|^dl$|dl\s*no|dl\s*num/.test(n))                  return 'id_number';
    if (/passport\s*no|passport\s*num|^ppn$/.test(n))                                 return 'id_number';
    if (/ration\s*card/.test(n))                                                      return 'id_number';
    if (/abha|ayushman|health\s*id/.test(n))                                          return 'id_number';
    if (/esic|\bpf\b|uan\s*no|uan\s*num|\buan\b|\bepf\b/.test(n))                    return 'id_number';

    //  Generic ID numbers 
    if (/roll\s*no|roll\s*num|^roll$/.test(n))                                        return 'id_number';
    if (/emp\s*code|employee\s*code|emp\s*id|staff\s*id/.test(n))                     return 'id_number';
    if (/admis?si?on\s*(?:no|num)/.test(n))                                           return 'id_number';
    if (/reg\s*no|registra?ti?on|enrol/.test(n))                                      return 'id_number';
    if (/scholar\s*(?:no|num|id|code)?\b|^scholar$/.test(n))                          return 'id_number';
    if (/unique\s*(?:no|num|id|code)|^unique$/.test(n))                               return 'id_number';
    if (/teacher\s*(?:code|id|no)|^sch\s*no$|\bsch\s*no\b|school\s*(?:no|num|id)/.test(n)) return 'id_number';
    if (/id\s*card\s*no|id\s*card\s*num|id\s*no|idno|^id$/.test(n))                  return 'id_number';
    if (/service\s*no|service\s*num/.test(n))                                         return 'id_number';

    //  Names (after phone + ID patterns) 
    if (/husband|wife|spouse/.test(n))                                                return 'name';
    if (/gu?a?rdi?a?n/.test(n))                                                      return 'name';
    if (/fa?the?r|mothe?r|parent|papa|maa|mata|pita/.test(n))                         return 'name';
    if (/full\s*n|first\s*n|middle\s*n|last\s*n|sur\s*n|student\s*n|emp\s*n|employee\s*n|^name$|^nm$|^nme$/.test(n)) return 'name';
    if (/reporting\s*manager|manager\s*n/.test(n))                                    return 'name';
    if (/\bname\b/.test(n))                                                           return 'name';

    //  Address 
    if (/addr|adre?s|residen|location|locality|village|town|city|distt?|state|province|landmark|sector|block|area/.test(n)) return 'address';
    if (/^city$|^town$|^village$|^vill$/.test(n))   return 'address_sub';
    if (/^district$|^dist$|^distt$/.test(n))         return 'address_sub';
    if (/^state$|^province$/.test(n))                return 'address_sub';
    if (/pin\s*code|^pin$|^zip$|postal\s*code|^pincode$/.test(n)) return 'pincode';
    if (/^country$/.test(n))                         return 'address_sub';

    //  Nationality / Religion / Caste / Marital 
    if (/nat[io]+na?li?ty?|^nation$/.test(n))        return 'short_text';
    if (/religi?o?n|^rlgn$/.test(n))                 return 'short_text';
    if (/caste|catego?r?y?|^cat$/.test(n))            return 'short_text';
    if (/marita?l|marri?e?d|unmarri?e?d/.test(n))     return 'short_text';
    if (/\brank\b/.test(n))                           return 'short_text';

    //  Organisation / Education 
    if (/college|^school$|institu|^university$|^branch$|branch\s*name|^depart|^dept$|designa|^course$|^batch$|^semester$|^stream$/.test(n)) return 'org_text';

    //  Transport 
    if (/bus|stop\s*name|route\s*no|route\s*name|driver|^transport$|^transpor$|trans\s*port|tran\s*sport|transport\s*(mode|type|detail)?/.test(n)) return 'short_text';

    //  Misc 
    if (/hostel|room\s*no/.test(n))          return 'short_text';
    if (/library|lab\s*access|lab\s*code/.test(n)) return 'short_text';

    return 'text';
};

//  Alignment helper 
// Returns 'center' or 'left' based on category.
FC.align = function (category) {
    switch (category) {
        case 'sr_no':
        case 'blood_group':
        case 'age':
        case 'gender':
        case 'class_section':
        case 'date':
        case 'phone':
        case 'emergency_phone':
        case 'id_number':
        case 'relationship':
        case 'pincode':
        case 'short_text':
            return 'center';
        default:
            return 'left';
    }
};

//  Width+Alignment CSS class helper (for table <td>) 
// Returns a complete Tailwind class string for a field cell.
FC.tdClass = function (fieldName, fieldType) {
    var cat = FC.classify(fieldName, fieldType);
    switch (cat) {
        case 'sr_no':        return 'w-[36px] text-center whitespace-nowrap';
        case 'age':          return 'w-[38px] text-center whitespace-nowrap';
        case 'gender':       return 'w-[52px] text-center whitespace-nowrap';
        case 'blood_group':  return 'w-[45px] text-center whitespace-nowrap';
        case 'class_section':return 'w-[52px] text-center whitespace-nowrap';
        case 'date':         return 'w-[80px] text-center whitespace-nowrap';
        case 'relationship': return 'min-w-[62px] max-w-[120px] text-center whitespace-normal break-words';
        case 'emergency_phone': return 'min-w-[110px] max-w-[150px] text-center whitespace-nowrap';
        case 'phone':        return 'min-w-[130px] text-center whitespace-nowrap phone-col';
        case 'email':        return 'min-w-[130px] max-w-[200px] text-left whitespace-normal break-words email-col';
        case 'id_number':    return 'min-w-[100px] text-center whitespace-nowrap id-number-col';
        case 'name':         return 'min-w-[100px] text-left whitespace-normal break-words';
        case 'address':      return 'min-w-[130px] max-w-[220px] text-left whitespace-normal break-words address-col';
        case 'address_sub':  return 'min-w-[70px] text-left whitespace-normal break-words';
        case 'pincode':      return 'w-[60px] text-center whitespace-nowrap pincode-col';
        case 'short_text':   return 'min-w-[60px] text-center whitespace-normal break-words';
        case 'org_text':     return 'min-w-[80px] text-center whitespace-normal break-words';
        default:             return 'min-w-[80px] text-left whitespace-normal break-words';
    }
};

//  Truncate username for display 
FC.truncateUser = function (username, maxLen) {
    if (!username) return '';
    maxLen = maxLen || 7;
    username = username.trim();
    if (username.length <= maxLen) return username;
    return username.substring(0, maxLen) + '..';
};

//  Basic field validation (for inline edit + add/edit modal) 
// Returns { valid: true } or { valid: false, message: '' }
// Empty values are always valid (not required validation).
FC.validate = function (fieldName, fieldType, value) {
    if (!value || !value.trim()) return { valid: true };
    var cat = FC.classify(fieldName, fieldType);
    var v = value.trim();

    switch (cat) {
        case 'email':
            if (v.indexOf('@') === -1)
                return { valid: false, message: 'Email should contain @' };
            if (v.indexOf('.') === -1)
                return { valid: false, message: 'Email should contain a domain (e.g. @gmail.com)' };
            break;

    }
    return { valid: true };
};

window.FieldClassifier = FC;
})();
