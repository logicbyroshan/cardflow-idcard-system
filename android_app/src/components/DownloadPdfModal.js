import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  View, Text, StyleSheet, Modal, TouchableOpacity, 
  Switch, ScrollView, ActivityIndicator, TouchableWithoutFeedback, 
  Dimensions, Linking 
} from 'react-native';
import { DynamicIcon } from './Icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, gradients } from '../theme';
import { apiGet, apiPost, BASE_URL } from '../api/client';

const { width } = Dimensions.get('window');

/**
 * Premium Download PDF Modal with advanced configurations:
 * 1. Choose Page Break Mode (Class + Section vs. Class Only)
 * 2. Select Template (Dynamically loaded from API)
 * 3. Shorten Text Titles Option
 * 4. Inline generation progress tracking & polling
 * 5. Abort/Cancel capability
 */
export default function DownloadPdfModal({ 
  visible, 
  onClose, 
  tableId, 
  tableName, 
  status, 
  selectedIds = [], 
  searchQuery = '', 
  activeFilters = {} 
}) {
  
  // States
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  
  // Form selections
  const [selectedTemplate, setSelectedTemplate] = useState(null); // { id, name } or null
  const [breakMode, setBreakMode] = useState('class_section'); // 'class_section' | 'class_only'
  const [shortenTitles, setShortenTitles] = useState(false);
  
  // Progress states
  // 'setup' | 'submitting' | 'processing' | 'completed' | 'failed'
  const [phase, setPhase] = useState('setup'); 
  const [progress, setProgress] = useState(0); // 0 to 100
  const [statusMessage, setStatusMessage] = useState('');
  const [taskId, setTaskId] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch templates when visible
  useEffect(() => {
    if (visible) {
      // Reset state
      setPhase('setup');
      setProgress(0);
      setStatusMessage('');
      setTaskId(null);
      setDownloadUrl('');
      setErrorMessage('');
      setSelectedTemplate(null);
      setBreakMode('class_section');
      setShortenTitles(false);
      loadTemplates();
    }
  }, [visible]);

  // Template loader
  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { ok, data } = await apiGet('/api/export-templates/');
      if (ok && data?.success) {
        const fetched = data.templates || [];
        setTemplates(fetched);
        
        // Auto-select default template
        const defaultTpl = fetched.find(t => t.is_default);
        if (defaultTpl) {
          setSelectedTemplate({ id: defaultTpl.id, name: defaultTpl.name });
        }
      }
    } catch (e) {
      console.warn('Failed to load export templates:', e);
    }
    setLoading(false);
  };

  // Polling loop ref to allow cancelling
  const pollTimerRef = React.useRef(null);
  const abortControllerRef = React.useRef(null);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Poll status of the async PDF task
  const pollTaskStatus = useCallback(async (tid) => {
    if (phase === 'completed' || phase === 'failed') return;
    
    try {
      const { ok, data } = await apiGet(`/api/export/status/${tid}/`);
      if (!ok || !data?.success) {
        // Retry or fail
        return;
      }

      if (data.state === 'completed' && data.download_url) {
        setProgress(100);
        setStatusMessage('PDF generated successfully!');
        setDownloadUrl(data.download_url);
        setPhase('completed');
        
        // Automatically open the downloaded PDF in the system browser
        const fullUrl = data.download_url.startsWith('http') ? data.download_url : `${BASE_URL}${data.download_url}`;
        Linking.openURL(fullUrl).catch(() => {});
        return;
      }

      if (data.state === 'failed') {
        setErrorMessage(data.message || 'PDF generation failed on server.');
        setPhase('failed');
        return;
      }

      // Update progress
      const p = Math.max(10, Math.min(95, Number(data.progress || data.progress_percentage || 0)));
      setProgress(p);
      setStatusMessage(data.message || 'Generating PDF document...');

      // Continue polling
      pollTimerRef.current = setTimeout(() => pollTaskStatus(tid), 2000);
    } catch (err) {
      // transient failure
      pollTimerRef.current = setTimeout(() => pollTaskStatus(tid), 2000);
    }
  }, [phase]);

  // Cancel active download
  const handleCancel = async () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    if (taskId) {
      // Notify server of cancellation
      try {
        await apiPost(`/api/task-cancel/${taskId}/`, {});
      } catch (_) {
        // silent
      }
    }
    onClose();
  };

  // Submit async PDF generation
  const handleGeneratePdf = async () => {
    setPhase('submitting');
    setProgress(5);
    setStatusMessage('Initiating request...');

    try {
      let finalCardIds = [...selectedIds];
      
      // If no specific card IDs selected, fetch all matching IDs for current status and filters
      if (finalCardIds.length === 0) {
        setStatusMessage('Resolving card IDs for current list...');
        const params = { status, search: searchQuery, ...activeFilters };
        const { ok, data } = await apiGet(`/api/mobile/table/${tableId}/cards/all-ids/`, params);
        if (ok && data?.card_ids) {
          finalCardIds = data.card_ids;
        }
      }

      if (finalCardIds.length === 0) {
        setErrorMessage('No cards found matching current selection/filters.');
        setPhase('failed');
        return;
      }

      setStatusMessage('Queuing background generation...');
      setProgress(15);

      const payload = {
        card_ids: finalCardIds,
        status,
        template_id: selectedTemplate ? selectedTemplate.id : null,
        break_mode: breakMode,
        shorten_titles: shortenTitles
      };

      const { ok, data } = await apiPost(`/api/table/${tableId}/cards/download-pdf-async/`, payload);
      
      if (ok && data?.success && data?.task_id) {
        setTaskId(data.task_id);
        setPhase('processing');
        setProgress(20);
        setStatusMessage(data.message || 'Processing card layouts...');
        
        // Start polling status
        pollTimerRef.current = setTimeout(() => pollTaskStatus(data.task_id), 1200);
      } else {
        setErrorMessage(data?.message || 'Server failed to queue PDF export.');
        setPhase('failed');
      }
    } catch (e) {
      setErrorMessage(e.message || 'Connection error. Failed to start export.');
      setPhase('failed');
    }
  };

  // Open PDF directly
  const handleOpenPdf = () => {
    if (!downloadUrl) return;
    const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${BASE_URL}${downloadUrl}`;
    Linking.openURL(fullUrl).catch(() => {});
  };

  const getRecordCountLabel = useMemo(() => {
    if (selectedIds.length > 0) return `${selectedIds.length} SELECTED RECORDS`;
    return 'ALL LIST RECORDS';
  }, [selectedIds]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={s.overlay}>
        <TouchableWithoutFeedback onPress={phase === 'setup' ? onClose : undefined}>
          <View style={s.backdrop} />
        </TouchableWithoutFeedback>

        <View style={s.card}>
          {/* Header */}
          <View style={s.header}>
            <View style={[s.iconCircle, { backgroundColor: `${colors.brandPrimary}15`, borderColor: `${colors.brandPrimary}35` }]}>
              <DynamicIcon name="file-pdf" size={24} color={colors.brandPrimary} />
            </View>
            <Text style={s.title}>PDF Generation</Text>
            <Text style={s.subtitle}>{tableName || 'ID Card Table'} • {getRecordCountLabel}</Text>
          </View>

          {/* Setup Phase */}
          {phase === 'setup' && (
            <ScrollView style={s.formScroll} showsVerticalScrollIndicator={false}>
              
              {/* Template Selection */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Footer Template</Text>
                {loading ? (
                  <ActivityIndicator size="small" color={colors.brandPrimary} style={{ marginVertical: 10 }} />
                ) : (
                  <TouchableOpacity 
                    style={s.dropdownSelector} 
                    onPress={() => setShowTemplatePicker(true)}
                  >
                    <Text style={s.dropdownSelectorText} numberOfLines={1}>
                      {selectedTemplate ? selectedTemplate.name : 'Default Template (No Footer)'}
                    </Text>
                    <DynamicIcon name="chevron-down" size={12} color={colors.gray400} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Page Break Selection */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Page Break Configuration</Text>
                <View style={s.chipRow}>
                  <TouchableOpacity 
                    onPress={() => setBreakMode('class_section')} 
                    style={[s.chip, breakMode === 'class_section' && s.chipActive]}
                  >
                    <View style={[s.radioCircle, breakMode === 'class_section' && s.radioCircleActive]}>
                      {breakMode === 'class_section' && <View style={s.radioDot} />}
                    </View>
                    <Text style={[s.chipText, breakMode === 'class_section' && s.chipTextActive]}>Class + Section</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    onPress={() => setBreakMode('class_only')} 
                    style={[s.chip, breakMode === 'class_only' && s.chipActive]}
                  >
                    <View style={[s.radioCircle, breakMode === 'class_only' && s.radioCircleActive]}>
                      {breakMode === 'class_only' && <View style={s.radioDot} />}
                    </View>
                    <Text style={[s.chipText, breakMode === 'class_only' && s.chipTextActive]}>Class Only</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Shorten Titles Toggle */}
              <View style={[s.section, s.rowOption]}>
                <View style={s.rowOptionTextWrap}>
                  <Text style={s.optionTitle}>Shorten Titles</Text>
                  <Text style={s.optionSubtitle}>Truncates long designations / class labels</Text>
                </View>
                <Switch 
                  value={shortenTitles} 
                  onValueChange={setShortenTitles}
                  trackColor={{ false: colors.gray200, true: `${colors.brandPrimary}80` }}
                  thumbColor={shortenTitles ? colors.brandPrimary : colors.gray300}
                />
              </View>
            </ScrollView>
          )}

          {/* Generating / Processing Phase */}
          {(phase === 'submitting' || phase === 'processing') && (
            <View style={s.progressContainer}>
              <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginBottom: 20 }} />
              
              <Text style={s.progressTitle}>Generating Document...</Text>
              
              {/* Progress track */}
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${progress}%` }]} />
              </View>
              
              <Text style={s.progressPercent}>{Math.round(progress)}%</Text>
              <Text style={s.progressMessage}>{statusMessage}</Text>
            </View>
          )}

          {/* Completed Phase */}
          {phase === 'completed' && (
            <View style={s.resultContainer}>
              <View style={[s.resultIconCircle, { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }]}>
                <DynamicIcon name="check-circle" size={40} color="#10b981" />
              </View>
              <Text style={s.resultTitle}>Document Ready!</Text>
              <Text style={s.resultMessage}>The PDF file was generated and is ready to download.</Text>
              
              <TouchableOpacity onPress={handleOpenPdf} style={s.openBtnWrap}>
                <LinearGradient colors={['#10b981', '#059669']} style={s.openBtn}>
                  <DynamicIcon name="download" size={14} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={s.openBtnText}>Open / Download PDF</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {/* Failed Phase */}
          {phase === 'failed' && (
            <View style={s.resultContainer}>
              <View style={[s.resultIconCircle, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
                <DynamicIcon name="exclamation-circle" size={40} color="#ef4444" />
              </View>
              <Text style={s.resultTitle}>Generation Failed</Text>
              <Text style={[s.resultMessage, { color: '#ef4444' }]}>{errorMessage || 'An unexpected error occurred during export.'}</Text>
            </View>
          )}

          {/* Footer Actions */}
          <View style={s.footer}>
            {phase === 'setup' && (
              <>
                <TouchableOpacity onPress={onClose} style={s.cancelBtn}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleGeneratePdf} style={s.confirmBtnWrap}>
                  <LinearGradient colors={gradients.brand} style={s.confirmBtn}>
                    <Text style={s.confirmText}>Generate PDF</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}

            {(phase === 'submitting' || phase === 'processing') && (
              <TouchableOpacity onPress={handleCancel} style={[s.cancelBtn, { width: '100%' }]}>
                <Text style={s.cancelText}>Abort / Cancel</Text>
              </TouchableOpacity>
            )}

            {(phase === 'completed' || phase === 'failed') && (
              <TouchableOpacity onPress={onClose} style={[s.cancelBtn, { width: '100%', backgroundColor: colors.gray100 }]}>
                <Text style={[s.cancelText, { color: colors.gray600 }]}>Close Dialog</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Dynamic Template Picker Options Dropdown Selector Menu */}
        {showTemplatePicker && (
          <View style={s.menuOverlayContainer}>
            <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setShowTemplatePicker(false)}>
              <View style={s.menuContent}>
                <Text style={s.menuTitle}>Select Template</Text>
                
                <TouchableOpacity 
                  style={[s.menuItem, !selectedTemplate && s.menuItemActive]} 
                  onPress={() => {
                    setSelectedTemplate(null);
                    setShowTemplatePicker(false);
                  }}
                >
                  <Text style={[s.menuItemText, !selectedTemplate && s.menuItemTextActive]}>
                    Default Template (No Footer)
                  </Text>
                </TouchableOpacity>

                {templates.map(tpl => {
                  const isActive = selectedTemplate?.id === tpl.id;
                  return (
                    <TouchableOpacity 
                      key={tpl.id} 
                      style={[s.menuItem, isActive && s.menuItemActive]} 
                      onPress={() => {
                        setSelectedTemplate({ id: tpl.id, name: tpl.name });
                        setShowTemplatePicker(false);
                      }}
                    >
                      <Text style={[s.menuItemText, isActive && s.menuItemTextActive]}>
                        {tpl.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity style={s.menuCancel} onPress={() => setShowTemplatePicker(false)}>
                  <Text style={s.menuCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.75)' },
  card: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: radius.md,
    padding: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    ...shadows.xl
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 16
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginBottom: 10
  },
  title: {
    fontSize: 18,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
    textAlign: 'center'
  },
  subtitle: {
    fontSize: 11,
    fontFamily: 'SairaSemiCondensed-Medium',
    color: colors.gray400,
    marginTop: 2,
    textAlign: 'center'
  },
  formScroll: {
    maxHeight: 280,
    marginBottom: 20
  },
  section: {
    marginBottom: 20
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray400,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10
  },
  dropdownSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  dropdownSelectorText: {
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: colors.gray800,
    flex: 1
  },
  chipRow: {
    flexDirection: 'row',
    columnGap: 10
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    columnGap: 8
  },
  chipActive: {
    borderColor: colors.brandPrimary,
    backgroundColor: `${colors.brandPrimary}08`
  },
  radioCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.gray400,
    alignItems: 'center',
    justifyContent: 'center'
  },
  radioCircleActive: {
    borderColor: colors.brandPrimary
  },
  radioDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brandPrimary
  },
  chipText: {
    fontSize: 11,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: colors.gray600
  },
  chipTextActive: {
    color: colors.brandPrimary
  },
  rowOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: radius.sm,
    padding: 12
  },
  rowOptionTextWrap: {
    flex: 1,
    marginRight: 10
  },
  optionTitle: {
    fontSize: 12,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: colors.gray800
  },
  optionSubtitle: {
    fontSize: 10,
    fontFamily: 'SairaSemiCondensed-Regular',
    color: colors.gray400,
    marginTop: 1
  },
  progressContainer: {
    alignItems: 'center',
    paddingVertical: 20
  },
  progressTitle: {
    fontSize: 15,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray700,
    marginBottom: 15
  },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: colors.gray100,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.brandPrimary,
    borderRadius: 4
  },
  progressPercent: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.brandPrimary,
    marginBottom: 4
  },
  progressMessage: {
    fontSize: 12,
    fontFamily: 'SairaSemiCondensed-Regular',
    color: colors.gray400,
    textAlign: 'center'
  },
  resultContainer: {
    alignItems: 'center',
    paddingVertical: 20
  },
  resultIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginBottom: 16
  },
  resultTitle: {
    fontSize: 16,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
    marginBottom: 8
  },
  resultMessage: {
    fontSize: 12,
    fontFamily: 'SairaSemiCondensed-Regular',
    color: colors.gray500,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20
  },
  openBtnWrap: {
    width: '100%',
    borderRadius: radius.sm,
    overflow: 'hidden',
    ...shadows.md
  },
  openBtn: {
    flexDirection: 'row',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  openBtnText: {
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: '#fff'
  },
  footer: {
    flexDirection: 'row',
    width: '100%',
    columnGap: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 16,
    marginTop: 10
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cancelText: {
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: colors.gray600
  },
  confirmBtnWrap: {
    flex: 1.5,
    borderRadius: radius.sm,
    overflow: 'hidden'
  },
  confirmBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  confirmText: {
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: '#fff'
  },
  menuOverlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.4)'
  },
  menuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16
  },
  menuContent: {
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    padding: 8,
    ...shadows.xl
  },
  menuTitle: {
    fontSize: 11,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray400,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingVertical: 12,
    letterSpacing: 1
  },
  menuItem: {
    padding: 16,
    borderRadius: radius.md,
    backgroundColor: '#fff'
  },
  menuItemActive: {
    backgroundColor: '#eff6ff'
  },
  menuItemText: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
    textAlign: 'center'
  },
  menuItemTextActive: {
    color: colors.brandPrimary
  },
  menuCancel: {
    marginTop: 8,
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9'
  },
  menuCancelText: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray400
  }
});
