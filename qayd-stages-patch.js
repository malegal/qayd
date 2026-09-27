/* =====================================================================
 * qayd-stages-patch.js
 * v1.0.0 — Multi-stage cases + judgment fields + duplicate fix
 *
 * يُحمَّل بعد renderer.js في index.html.
 * لا يعدّل الملف الأصلي — كل الإضافات والتجاوزات ديناميكية.
 * ===================================================================== */

(function () {
  'use strict';

  const PATCH_VERSION = '1.0.0';
  const STAGE_LABELS = {
    first_instance: 'أول درجة',
 appeal: 'استئناف',
 cassation: 'طعن بالنقض',
 retrial: 'التماس إعادة نظر',
 opposition: 'معارضة',
 enforcement: 'تنفيذ',
 execution_objection: 'إشكال تنفيذ',
 other: 'مرحلة'
  };

  /* ============================================================
   * A) حقن CSS
   * ============================================================ */
  function injectStyles() {
    if (document.getElementById('qayd-stages-patch-style')) return;
    const css = `
    .stage-chain-info {
      background: #f0f7ff;
      border-right: 4px solid var(--gold, #be9124);
      border-radius: 8px;
      padding: 10px 12px;
      margin-top: 12px;
      font-size: 0.92rem;
    }
    .stage-chain-info .stage-item {
      display: block;
      padding: 6px 0;
      border-bottom: 1px dashed #d9e1eb;
      cursor: pointer;
      transition: background 0.15s;
    }
    .stage-chain-info .stage-item:last-child { border-bottom: 0; }
    .stage-chain-info .stage-item:hover { background: #e6f0fb; }
    .stage-chain-info .stage-item.current {
      background: #fffbe6;
      font-weight: 700;
      border-radius: 6px;
      padding: 8px 6px;
    }
    .stage-add-btn {
      grid-column: 1 / -1 !important;
      background: linear-gradient(135deg, #be9124 0%, #d5b04c 100%);
      color: #0f172a !important;
      font-weight: 800;
      border: 0;
      padding: 10px;
      border-radius: 8px;
      margin-top: 4px;
    }
    .stage-add-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(190,145,36,.35); }
    .stage-history-card {
      background: #fff;
      border: 1px solid #d9e1eb;
      border-right: 5px solid #be9124;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 14px;
    }
    .stage-history-card.current { border-right-color: #16a34a; background: #f0fdf4; }
    .stage-history-card .stage-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px;
    }
    .stage-history-card .stage-header h5 { margin: 0; color: #8a6814; font-weight: 800; }
    .stage-history-card .stage-meta {
      display: grid; grid-template-columns: repeat(2, 1fr);
      gap: 6px; font-size: 0.92rem; color: #172b45;
    }
    .stage-history-card .stage-meta strong { color: #12335b; }
    .stage-history-card .judgment-box {
      grid-column: 1 / -1;
      background: #ecfdf5;
      border-right: 3px solid #16a34a;
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 6px;
      color: #064e3b;
    }
    .judgment-fields-box {
      border: 1px solid #16a34a;
      background: #f0fdf4;
      border-radius: 10px;
      padding: 14px;
      margin-top: 8px;
    }
    .judgment-fields-box .title {
      color: #065f46;
      font-weight: 800;
      margin-bottom: 10px;
      font-size: 1.05rem;
    }
    `;
    const style = document.createElement('style');
    style.id = 'qayd-stages-patch-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ============================================================
   * B) حقن المودالات
   * ============================================================ */
  function injectModals() {
    if (document.getElementById('addStageModal')) return;

    const html = `
    <!-- ============ مودال إضافة مرحلة تقاضٍ ============ -->
    <div class="modal fade" id="addStageModal" tabindex="-1">
    <div class="modal-dialog modal-lg">
    <div class="modal-content">
    <div class="modal-header">
    <h5 class="modal-title gold-text">
    <i class="bi bi-diagram-3"></i> إضافة مرحلة تقاضٍ جديدة
    </h5>
    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">
    <div class="alert alert-info small mb-3">
    <strong>الملف الأصلي:</strong> <span id="stageParentInfo">—</span>
    </div>
    <div class="row g-3">
    <div class="col-md-4">
    <label>نوع المرحلة</label>
    <select id="stage_type" class="form-select">
    <option value="appeal">استئناف</option>
    <option value="retrial">التماس إعادة نظر</option>
    <option value="cassation">طعن بالنقض</option>
    <option value="opposition">معارضة</option>
    <option value="enforcement">تنفيذ</option>
    <option value="execution_objection">إشكال تنفيذ</option>
    </select>
    </div>
    <div class="col-md-4">
    <label>رقم القضية الجديد</label>
    <input id="stage_case_number" class="form-control" placeholder="مثال: 5583">
    </div>
    <div class="col-md-4">
    <label>السنة</label>
    <input id="stage_case_year" class="form-control" placeholder="مثال: 2026">
    </div>
    <div class="col-md-6">
    <label>المحكمة</label>
    <input id="stage_court_name" class="form-control" placeholder="محكمة استئناف القاهرة">
    </div>
    <div class="col-md-3">
    <label>الدائرة</label>
    <input id="stage_circuit" class="form-control">
    </div>
    <div class="col-md-3">
    <label>المدينة</label>
    <input id="stage_city" class="form-control">
    </div>
    <div class="col-md-6">
    <label>صفة العميل في المرحلة الجديدة</label>
    <select id="stage_client_role" class="form-select">
    <option value="مستأنف">مستأنف</option>
    <option value="مستأنف ضده">مستأنف ضده</option>
    <option value="طاعن">طاعن</option>
    <option value="مطعون ضده">مطعون ضده</option>
    <option value="معارض">معارض</option>
    <option value="معارض ضده">معارض ضده</option>
    </select>
    </div>
    <div class="col-md-6">
    <label>صفة الخصم في المرحلة الجديدة</label>
    <input id="stage_opponent_role" class="form-control" placeholder="مثال: مستأنف ضده">
    </div>
    <div class="col-12">
    <label>موضوع المرحلة / ملاحظات</label>
    <textarea id="stage_subject" class="form-control" rows="2"></textarea>
    </div>
    </div>
    </div>
    <div class="modal-footer">
    <button class="btn btn-secondary" data-bs-dismiss="modal">إلغاء</button>
    <button class="gold-btn" onclick="saveStage()">
    <i class="bi bi-check2"></i> حفظ المرحلة
    </button>
    </div>
    </div>
    </div>
    </div>

    <!-- ============ مودال سجل المراحل ============ -->
    <div class="modal fade" id="stageHistoryModal" tabindex="-1">
    <div class="modal-dialog modal-xl">
    <div class="modal-content">
    <div class="modal-header">
    <h5 class="modal-title gold-text">
    <i class="bi bi-clock-history"></i> سجل المراحل القضائية
    </h5>
    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">
    <div id="stageHistoryBody"></div>
    </div>
    <div class="modal-footer">
    <button class="btn btn-secondary" data-bs-dismiss="modal">إغلاق</button>
    </div>
    </div>
    </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  /* ============================================================
   * C) حقن حقول الحكم داخل نموذج القضية
   * ============================================================ */
  function injectJudgmentFields() {
    if (document.getElementById('judgmentFields')) return;
    const form = document.getElementById('caseFormModal');
    if (!form) return;

    const html = `
    <div class="col-12" id="judgmentFields" style="display:none;">
    <div class="judgment-fields-box">
    <div class="title">📋 بيانات الحكم</div>
    <div class="row g-3">
    <div class="col-md-4">
    <label>تاريخ صدور الحكم</label>
    <input type="date" id="case_judgment_date" class="form-control">
    </div>
    <div class="col-md-8">
    <label>منطوق الحكم</label>
    <textarea id="case_judgment_summary" class="form-control" rows="2"
    placeholder="حكمت المحكمة بـ..."></textarea>
    </div>
    </div>
    </div>
    </div>
    `;
    form.insertAdjacentHTML('beforeend', html);

    const select = document.getElementById('case_status');
    if (select) {
      const handler = () => window.toggleJudgmentFields(select.value);
      select.addEventListener('change', handler);
      select.addEventListener('input', handler);
    }
  }

  /* ============================================================
   * D) تجاوز الدوال الأصلية
   * ============================================================ */
  function patchFunctions() {
    if (typeof window.generateCaseCode !== 'function' ||
      typeof window.escapeHtml !== 'function') {
      setTimeout(patchFunctions, 200);
    return;
      }

      /* ---- 1) toggleJudgmentFields ---- */
      window.toggleJudgmentFields = function (status) {
        const el = document.getElementById('judgmentFields');
        if (!el) return;
        el.style.display = (status === 'تم الحكم') ? 'block' : 'none';
      };

      /* ---- 2) saveNewCase ---- */
      window.saveNewCase = async function () {
        const caseData = {
          id: 'C_' + Date.now(),
 office_id: window.currentOfficeId,
 client_name: document.getElementById('client_name').value,
 client_phone: document.getElementById('client_phone').value,
 client_national_id: document.getElementById('client_national_id')?.value || '',
 client_email: document.getElementById('client_email').value,
 client_address: document.getElementById('client_address')?.value || '',
 client_role: document.getElementById('client_role').value,
 opponent_name: document.getElementById('opponent_name').value,
 opponent_role: document.getElementById('opponent_role')?.value || '',
 opponent_national_id: document.getElementById('opponent_national_id')?.value || '',
 opponent_email: document.getElementById('opponent_email')?.value || '',
 opponent_phone: document.getElementById('opponent_phone')?.value || '',
 opponent_address: document.getElementById('opponent_address')?.value || '',
 case_number: document.getElementById('case_number').value,
   case_year: document.getElementById('case_year').value,
     court_name: document.getElementById('court_name').value,
 circuit: document.getElementById('circuit').value,
 case_type: document.getElementById('case_type').value,
   case_subject: document.getElementById('case_subject').value,
     category: document.getElementById('case_type').value,
 proceeding_type: document.getElementById('case_stage')?.value || 'first_instance',
 importance: document.getElementById('case_importance')?.value || 'normal',
 alert_notes: document.getElementById('case_alert_notes')?.value || '',
 status: document.getElementById('case_status')?.value || 'جديدة',
 city: document.getElementById('case_city')?.value || '',
 judgment_date: document.getElementById('case_judgment_date')?.value || null,
 judgment_summary: document.getElementById('case_judgment_summary')?.value.trim() || null,
 case_code: await window.generateCaseCode(),
   archived: 0
        };

        caseData.case_code = window.assertValidCaseCode
        ? window.assertValidCaseCode(caseData.case_code)
        : caseData.case_code;

        const now = new Date().toISOString();
        const legalFile = {
          id: `LF-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
 office_id: window.currentOfficeId,
 file_code: caseData.case_code,
 file_type: 'judicial',
 title: caseData.case_subject || `ملف ${caseData.client_name}`,
 status: 'new',
 client_name: caseData.client_name,
 client_phone: caseData.client_phone,
 client_email: caseData.client_email,
 client_national_id: caseData.client_national_id,
 client_address: caseData.client_address,
 description: caseData.case_subject || '',
 opened_at: now.slice(0, 10),
 metadata: { source: 'case_creation' },
 created_at: now,
 updated_at: now
        };

        const proceeding = {
          id: `PR-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
 legal_file_id: legalFile.id,
 office_id: window.currentOfficeId,
 proceeding_type: caseData.proceeding_type,
 parent_proceeding_id: null,
 appeal_of_proceeding_id: null,
 court_name: caseData.court_name,
 circuit: caseData.circuit,
 case_number: caseData.case_number,
   case_year: caseData.case_year,
     city: caseData.city,
 client_position: caseData.client_role,
 opponent_name: caseData.opponent_name,
 opponent_position: caseData.opponent_role,
 status: caseData.judgment_summary ? 'judgment_issued' : 'open',
 judgment_summary: caseData.judgment_summary,
 judgment_date: caseData.judgment_date,
 metadata: {},
 created_at: now,
 updated_at: now
        };

        caseData.legal_file_id = legalFile.id;
        caseData.proceeding_id = proceeding.id;
        caseData.root_case_id = caseData.id;

        await window.db.legalFiles.put(legalFile);
        await window.db.proceedings.put(proceeding);
        await window.db.pendingOperations.add({ operation: 'upsert_legal_file', data: legalFile, timestamp: Date.now() });
        await window.db.pendingOperations.add({ operation: 'upsert_proceeding', data: proceeding, timestamp: Date.now() });
        await window.db.cases.add(caseData);

        // ✅ الأطراف الإضافية فقط (الأساسيين مخزّنون في cases)
        const additionalParties = window.collectAdditionalParties
        ? window.collectAdditionalParties(caseData.id)
        : [];
        if (additionalParties.length) {
          await window.db.caseParties.bulkAdd(additionalParties);
          for (const p of additionalParties) {
            await window.db.pendingOperations.add({
              operation: 'upsert_case_party',
              data: p,
              timestamp: Date.now()
            });
          }
        }

        // محاولة المزامنة المباشرة
        if (window.supabaseClient && window.currentOfficeId) {
          try {
            await window.supabaseClient.from('legal_files').upsert([legalFile], { onConflict: 'id' });
            await window.supabaseClient.from('proceedings').upsert([proceeding], { onConflict: 'id' });
            const { data: inserted, error } = await window.supabaseClient
            .from('cases').insert([caseData]).select('case_code');
            if (!error && inserted && inserted[0]) {
              // نجحت المزامنة الفورية
            }
          } catch (err) {
            console.warn('مزامنة فورية فشلت — ستُرفع لاحقاً:', err?.message);
          }
        }

        // الأتعاب
        const feeTotal = parseFloat(document.getElementById('fee_total').value) || 0;
        if (feeTotal > 0) {
          const feePaid = parseFloat(document.getElementById('fee_paid').value) || 0;
          await window.db.fees.put({
            case_id: caseData.id,
              total: feeTotal,
              paid: feePaid,
              remaining: feeTotal - feePaid,
              notes: document.getElementById('fee_notes').value
          });
          if (feePaid > 0) {
            await window.db.payments.add({
              case_id: caseData.id,
                amount: feePaid,
                date: new Date().toISOString().split('T')[0],
                                         note: 'دفعة مقدمة'
            });
          }
        }
        const initialExpense = parseFloat(document.getElementById('case_expense_amount')?.value) || 0;
        if (initialExpense > 0) {
          await window.db.expenses.add({
            office_id: window.currentOfficeId,
            owner_id: caseData.id,
            case_id: caseData.id,
              amount: initialExpense,
              date: new Date().toISOString().split('T')[0],
                                       category: document.getElementById('case_expense_category')?.value || 'مصروف ابتدائي'
          });
        }

        // إنشاء المجلد
        if (window.ipcRenderer?.createCaseFolder) {
          window.ipcRenderer.createCaseFolder(caseData.case_code, caseData.client_name, caseData);
        }

        window.hideModal('addCaseModal');
        document.getElementById('caseFormModal').reset();
        document.getElementById('judgmentFields').style.display = 'none';
        document.getElementById('feesSectionModal').style.display = 'none';

        window.Swal.fire({
          icon: 'success',
          title: 'تم حفظ الملف القضائي',
          html: `<div>كود الملف: <strong>${caseData.case_code}</strong></div>`,
          timer: 2500,
          showConfirmButton: false,
          background: '#0f172a',
          color: '#fff'
        });

        if (window.loadCasesList) await window.loadCasesList();
        if (window.updatePendingBadge) window.updatePendingBadge();
      };

        /* ---- 3) openCaseDetails ---- */
        window.openCaseDetails = async function (id) {
          if (!id) return;
          try {
            if (!window.currentUserRole && window.currentOfficeId === window.OWNER_OFFICE_ID) {
              window.currentUserRole = 'manager';
            }
            const c = await window.db.cases.get(id);
            if (!c) return;
            window.activeCaseId = id;

            const esc = window.escapeHtml || (s => String(s || ''));
            const hasJudgment = c.status === 'تم الحكم' || (c.judgment_summary && c.judgment_summary.length > 0);

            // بناء بطاقة التفاصيل الأساسية
            const basicHtml = `
            <div class="record-detail">
            <div class="record-code">كود الملف: ${esc(c.case_code || '-')}</div>
            <div class="record-row"><strong>رقم القضية:</strong> ${esc(c.case_number || '-')} / ${esc(c.case_year || '-')}</div>
            <div class="record-row"><strong>المحكمة والدائرة:</strong> ${esc(c.court_name || '-')} — ${esc(c.circuit || '-')}</div>
            <div class="record-row"><strong>نوع القضية:</strong> ${esc(c.case_type || '-')}</div>
            <div class="record-row"><strong>صفة العميل:</strong> ${esc(c.client_role || '-')} · <strong>صفة الخصم:</strong> ${esc(c.opponent_role || '-')}</div>
            ${c.judgment_date ? `<div class="record-row"><strong>تاريخ الحكم:</strong> ${esc(c.judgment_date)}</div>` : ''}
            ${c.judgment_summary ? `<div class="record-row" style="background:#ecfdf5; border-right:3px solid #16a34a; padding:10px; border-radius:6px; margin-top:6px;"><strong>منطوق الحكم:</strong><br>${esc(c.judgment_summary)}</div>` : ''}
            <div class="record-row"><strong>موضوع القضية:</strong><br>${esc(c.case_subject || '-')}</div>
            </div>
            `;
            document.getElementById('caseDetailContent').innerHTML = basicHtml;

            // الجلسات
            const sessions = await window.db.sessions.where('case_id').equals(id).toArray();
            sessions.sort((a, b) => new Date(b.session_date) - new Date(a.session_date));
            window.currentCaseForPrint = { ...c, sessions };
            document.getElementById('caseDetailSessions').innerHTML = sessions.length
            ? sessions.map(x => `
            <div class="session-item-row">
            <div>
            <span class="text-info fw-bold fs-5">${new Date(x.session_date).toLocaleString('ar-EG', { dateStyle: 'full', timeStyle: 'short' })}</span>
            <span class="badge bg-light text-dark mx-3 fs-6">${esc(x.case_status)}</span>
            <div class="fs-6 mt-2 text-white">${esc(x.decision || 'لا يوجد قرار مسجل')}</div>
            </div>
            ${window.currentUserRole === 'manager' ? `<button class="btn btn-sm btn-outline-warning" onclick="event.stopPropagation(); openEditSession('${esc(x.id)}')"><i class="bi bi-pencil fs-5"></i></button>` : ''}
            </div>
            `).join('')
            : '<p class="text-muted">لا توجد جلسات مسجلة لهذه القضية.</p>';

            // الأزرار الأساسية
            const baseActions = window.detailActionsHtml
            ? window.detailActionsHtml(true, id)
            : '';

            // زر إضافة مرحلة
            const addStageBtn = hasJudgment && window.currentUserRole === 'manager'
            ? `<button class="stage-add-btn" onclick="openAddStageModal('${esc(c.id)}')">
            <i class="bi bi-diagram-3"></i> ➕ إضافة مرحلة تقاضٍ (استئناف / نقض)
            </button>`
            : '';

            document.getElementById('caseActionsPanel').innerHTML = baseActions + addStageBtn;

            // الأطراف الإضافية (بدون تكرار الأساسيين)
            const parties = await window.db.caseParties.where('case_id').equals(id).toArray();
            const additionalClients = parties.filter(p =>
            p.party_type === 'client' && p.name !== c.client_name
            );
            const additionalOpponents = parties.filter(p =>
            p.party_type === 'opponent' && p.name !== c.opponent_name
            );

            if (additionalClients.length || additionalOpponents.length) {
              const panel = document.getElementById('caseDetailContent');
              const partyCard = (title, rows) => rows.length ? `
              <div class="party-card" style="margin-top:10px;">
              <h6 class="gold-text">${title}</h6>
              ${rows.map(p => `
                <div style="border-bottom:1px dashed #d9e1eb; padding:6px 0;">
                <strong>${esc(p.name)}</strong> · ${esc(p.role || '')} · ${esc(p.phone || '')}
                </div>
                `).join('')}
                </div>
                ` : '';
                panel.insertAdjacentHTML('beforeend',
                                         partyCard('👥 عملاء إضافيون', additionalClients) +
                                         partyCard('👥 خصوم إضافيون', additionalOpponents)
                );
            }

            // سلسلة المراحل
            const rootId = c.root_case_id || c.id;
            const allStages = await window.db.cases
            .filter(x => (x.root_case_id === rootId || x.id === rootId) && !x.archived)
            .toArray();
            allStages.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

            if (allStages.length > 1) {
              const panel = document.getElementById('caseDetailContent');
              const stagesHtml = `
              <div class="stage-chain-info">
              <div style="font-weight:800; margin-bottom:8px; color:#12335b;">
              📜 سلسلة المراحل (${allStages.length})
              </div>
              ${allStages.map((s, i) => {
                const isCurrent = s.id === id;
                const lbl = STAGE_LABELS[s.proceeding_type] || 'مرحلة';
                return `
                <span class="stage-item ${isCurrent ? 'current' : ''}"
                onclick="${isCurrent ? '' : `openCaseDetails('${s.id}')`}">
                <span class="badge bg-${isCurrent ? 'success' : 'secondary'}">${i + 1}</span>
                <strong>${lbl}</strong>
                — ${esc(s.case_number || '')}/${esc(s.case_year || '')}
                ${isCurrent ? '<span class="badge bg-warning text-dark ms-2">الحالية</span>' : ''}
                ${s.judgment_summary ? `<div class="small text-success mt-1">✅ ${esc(s.judgment_summary.slice(0, 90))}...</div>` : ''}
                </span>
                `;
              }).join('')}
              <button class="btn btn-sm btn-outline-info w-100 mt-2"
              onclick="openStageHistory('${esc(rootId)}')">
              <i class="bi bi-clock-history"></i> عرض السجل الكامل
              </button>
              </div>
              `;
              panel.insertAdjacentHTML('beforeend', stagesHtml);
            }

            // إظهار قسم البيانات
            if (window.showCasePanelSection) window.showCasePanelSection('data');
          } catch (e) {
            console.error('[qayd-patch] openCaseDetails error:', e);
          }
        };

        /* ---- 4) filterCasesList ---- */
        window.filterCasesList = function () {
          const search = (document.getElementById('caseSearchInput')?.value || '').trim().toLowerCase();
          const court = document.getElementById('courtFilter')?.value || '';
          const service = document.getElementById('serviceFilter')?.value || '';
          const container = document.getElementById('casesListContainer');
          if (!container) return;

          const allRecords = window.allOfficeRecords || [];
          const judicialCases = allRecords.filter(r => r.record_type === 'judicial');
          const professionalFiles = allRecords.filter(r => r.record_type !== 'judicial');

          // تجميع القضايا حسب legal_file_id
          const groups = new Map();
          for (const c of judicialCases) {
            const key = c.legal_file_id || c.root_case_id || c.id;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(c);
          }

          const esc = window.escapeHtml || (s => String(s || ''));
          const cards = [];

          // بطاقات القضايا القضائية (المرحلة الأحدث فقط)
          for (const [key, stages] of groups) {
            stages.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
            const current = stages[stages.length - 1];
            const previous = stages.slice(0, -1);

            const haystack = [
              current.client_name, current.court_name, current.case_number,
 current.case_code, current.case_subject, current.opponent_name
            ].filter(Boolean).join(' ').toLowerCase();

            if (search && !haystack.includes(search)) continue;
            if (court && current.court_name !== court) continue;
            if (service && service !== 'judicial') continue;

            cards.push({ kind: 'judicial', current, previous, key });
          }

          // بطاقات الملفات المهنية
          for (const f of professionalFiles) {
            const haystack = [f.client_name, f.title, f.file_code, f.description]
            .filter(Boolean).join(' ').toLowerCase();
            if (search && !haystack.includes(search)) continue;
            if (court) continue;
            if (service && service !== f.record_type) continue;

            cards.push({ kind: 'professional', file: f });
          }

          if (cards.length === 0) {
            container.innerHTML = '<div class="text-center text-muted py-4">لا توجد ملفات مطابقة.</div>';
            return;
          }

          const profLabel = window.professionalTypeLabel || (t => t);

          container.innerHTML = cards.map(card => {
            if (card.kind === 'professional') {
              const f = card.file;
              return `
              <div class="case-card-item" onclick="selectProfessionalFile('${f.id}')">
              <div class="d-flex justify-content-between gap-2">
              <strong class="gold-text">${esc(f.client_name || f.title)}</strong>
              <span class="badge bg-success">${profLabel(f.record_type)}</span>
              </div>
              <div class="small mt-1">${esc(f.title || '')}</div>
              <div class="small text-warning mt-1">الكود: ${esc(f.file_code || '')}</div>
              </div>
              `;
            }

            const c = card.current;
            const prevCount = card.previous.length;
            const stageLabel = STAGE_LABELS[c.proceeding_type] || 'ملف قضائي';

            return `
            <div class="case-card-item" onclick="openCaseDetails('${c.id}')">
            <div class="d-flex justify-content-between gap-2">
            <strong class="gold-text">${esc(c.client_name)}</strong>
            <span class="badge bg-primary">${stageLabel}</span>
            </div>
            <div class="small mt-1">${esc(c.case_subject || '')}</div>
            <span class="badge bg-light text-dark case-status-badge mt-1">${esc(c.status || 'جديدة')}</span>
            <div class="small mt-1">
            <strong>${esc(c.case_number || '')}/${esc(c.case_year || '')}</strong>
            — ${esc(c.court_name || 'محكمة غير محددة')}
            </div>
            ${prevCount > 0 ? `
              <div class="small text-info mt-1">
              <i class="bi bi-clock-history"></i>
              ${prevCount} مرحلة سابقة
              (${card.previous.map(p => STAGE_LABELS[p.proceeding_type] || '؟').join(' ← ')})
              </div>
              ` : ''}
              ${c.judgment_summary ? `
                <div class="small text-success mt-1">
                ✅ ${esc(c.judgment_summary.slice(0, 60))}...
                </div>
                ` : ''}
                <div class="small text-warning mt-1">
                الكود: ${esc(c.case_code || '')}
                </div>
                </div>
                `;
          }).join('');
        };

        /* ---- 5) openAddStageModal ---- */
        window.openAddStageModal = async function (parentId) {
          if (window.ownerOnly && !window.ownerOnly('إضافة مرحلة تقاضٍ')) return;
          const parent = await window.db.cases.get(parentId);
          if (!parent) {
            window.Swal.fire('خطأ', 'الملف الأصلي غير موجود', 'error');
            return;
          }

          if (parent.status !== 'تم الحكم' && !parent.judgment_summary) {
            window.Swal.fire({
              icon: 'info',
              title: 'لا يمكن إضافة مرحلة',
              text: 'يجب أن تكون حالة المرحلة الحالية "تم الحكم" أولاً.',
              background: '#0f172a', color: '#fff'
            });
            return;
          }

          window._stageParentId = parentId;

          document.getElementById('stageParentInfo').textContent =
          `${parent.client_name} — ${parent.case_number || ''}/${parent.case_year || ''} (${parent.case_code})`;

          // تصفير
          ['stage_case_number','stage_case_year','stage_court_name','stage_circuit',
 'stage_city','stage_subject','stage_opponent_role'].forEach(id => {
   const el = document.getElementById(id);
   if (el) el.value = '';
 });

   // اقتراحات
   const yearEl = document.getElementById('stage_case_year');
   if (yearEl) yearEl.value = String(new Date().getFullYear());

   const typeEl = document.getElementById('stage_type');
          if (typeEl) {
            typeEl.value = 'appeal';
            typeEl.onchange = () => {
              const courts = {
                appeal: 'محكمة استئناف',
 cassation: 'محكمة النقض',
 retrial: 'محكمة الاستئناف',
 enforcement: 'محكمة التنفيذ'
              };
              const courtEl = document.getElementById('stage_court_name');
              if (courtEl && !courtEl.value) courtEl.value = courts[typeEl.value] || '';
            };
          }

          // اقتراح صفة الخصم
          const roleMap = {
            'مدعي': 'مدعى عليه', 'مدعى عليه': 'مدعي',
 'مستأنف': 'مستأنف ضده', 'مستأنف ضده': 'مستأنف',
 'طاعن': 'مطعون ضده', 'مطعون ضده': 'طاعن',
 'معارض': 'معارض ضده', 'معارض ضده': 'معارض'
          };
          const guessedRole = roleMap[parent.client_role] || 'مستأنف ضده';
          const roleEl = document.getElementById('stage_client_role');
          if (roleEl) roleEl.value = 'مستأنف';
          const oppEl = document.getElementById('stage_opponent_role');
          if (oppEl) oppEl.value = guessedRole;

          window.showModal('addStageModal');
        };

        /* ---- 6) saveStage ---- */
        window.saveStage = async function () {
          if (window.ownerOnly && !window.ownerOnly('حفظ المرحلة')) return;
          const parentId = window._stageParentId;
          if (!parentId) {
            window.Swal.fire('خطأ', 'لم يتم تحديد الملف الأصلي', 'error');
            return;
          }
          const parent = await window.db.cases.get(parentId);
          if (!parent) return;

          const stageData = {
            type: document.getElementById('stage_type').value,
 case_number: document.getElementById('stage_case_number').value.trim(),
   case_year: document.getElementById('stage_case_year').value.trim(),
     court_name: document.getElementById('stage_court_name').value.trim(),
 circuit: document.getElementById('stage_circuit').value.trim(),
 city: document.getElementById('stage_city').value.trim(),
 client_role: document.getElementById('stage_client_role').value,
 opponent_role: document.getElementById('stage_opponent_role').value.trim(),
 subject: document.getElementById('stage_subject').value.trim()
          };

          if (!stageData.case_number || !stageData.case_year || !stageData.court_name) {
            window.Swal.fire('تنبيه', 'أدخل رقم القضية والسنة والمحكمة', 'warning');
            return;
          }

          // ملف قانوني
          let legalFileId = parent.legal_file_id;
          if (!legalFileId) {
            const newLFId = `LF-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
            const now0 = new Date().toISOString();
            const legalFile = {
              id: newLFId,
 office_id: window.currentOfficeId,
 file_code: parent.case_code,
 file_type: 'judicial',
 title: parent.case_subject || `ملف ${parent.client_name}`,
 status: 'in_progress',
 client_name: parent.client_name,
 client_phone: parent.client_phone,
 description: parent.case_subject || '',
 opened_at: (parent.created_at || now0).slice(0, 10),
 metadata: { source: 'stage_creation' },
 created_at: parent.created_at || now0,
 updated_at: now0
            };
            await window.db.legalFiles.put(legalFile);
            await window.db.pendingOperations.add({ operation: 'upsert_legal_file', data: legalFile, timestamp: Date.now() });
            legalFileId = newLFId;
            await window.db.cases.update(parentId, { legal_file_id: legalFileId });
          }

          const now = new Date().toISOString();
          const proceedingId = `PR-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
          const proceeding = {
            id: proceedingId,
            legal_file_id: legalFileId,
            office_id: window.currentOfficeId,
            proceeding_type: stageData.type,
            parent_proceeding_id: parent.proceeding_id || null,
            appeal_of_proceeding_id: parent.proceeding_id || null,
            court_name: stageData.court_name,
            circuit: stageData.circuit || null,
            case_number: stageData.case_number,
              case_year: stageData.case_year,
                city: stageData.city || null,
                client_position: stageData.client_role,
                opponent_name: parent.opponent_name,
                opponent_position: stageData.opponent_role,
                status: 'open',
                metadata: { subject: stageData.subject },
                created_at: now,
                updated_at: now
          };

          const newCaseCode = await window.generateCaseCode();
          const newStage = {
            ...parent,
            id: 'C_' + Date.now(),
 case_code: newCaseCode,
   case_number: stageData.case_number,
     case_year: stageData.case_year,
       court_name: stageData.court_name,
       circuit: stageData.circuit,
       city: stageData.city || parent.city,
       client_role: stageData.client_role,
       opponent_role: stageData.opponent_role,
       case_subject: stageData.subject || parent.case_subject,
         proceeding_type: stageData.type,
         parent_case_id: parent.id,
         appeal_of_case_id: parent.id,
         root_case_id: parent.root_case_id || parent.id,
         proceeding_id: proceedingId,
         legal_file_id: legalFileId,
         status: 'جديدة',
         judgment_summary: null,
         judgment_date: null,
         created_at: now,
         updated_at: now,
         archived: 0
          };

          await window.db.proceedings.put(proceeding);
          await window.db.cases.add(newStage);

          await window.db.pendingOperations.bulkAdd([
            { operation: 'upsert_proceeding', data: proceeding, timestamp: Date.now() },
                                                    { operation: 'insert_case', data: newStage, timestamp: Date.now() }
          ]);

          if (window.ipcRenderer?.createCaseFolder) {
            try {
              await window.ipcRenderer.createCaseFolder(newStage.case_code, newStage.client_name, newStage);
            } catch (e) {
              console.warn('تعذر إنشاء مجلد المرحلة:', e);
            }
          }

          window.hideModal('addStageModal');
          window.Swal.fire({
            icon: 'success',
            title: 'تم إنشاء المرحلة',
            html: `
            <div style="text-align:right;">
            <p><strong>النوع:</strong> ${STAGE_LABELS[stageData.type] || stageData.type}</p>
            <p><strong>الرقم:</strong> ${stageData.case_number}/${stageData.case_year}</p>
            <p><strong>المحكمة:</strong> ${stageData.court_name}</p>
            <p><strong>الكود الجديد:</strong> ${newCaseCode}</p>
            </div>
            `,
            timer: 3500,
            showConfirmButton: false,
            background: '#0f172a', color: '#fff'
          });

          if (window.loadCasesList) await window.loadCasesList();
          if (window.updatePendingBadge) window.updatePendingBadge();
          setTimeout(() => window.openCaseDetails(newStage.id), 500);
        };

        /* ---- 7) openStageHistory ---- */
        window.openStageHistory = async function (rootCaseId) {
          const stages = await window.db.cases
          .filter(x => (x.root_case_id === rootCaseId || x.id === rootCaseId))
          .toArray();
          stages.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

          const esc = window.escapeHtml || (s => String(s || ''));

          const html = stages.map((s, i) => {
            const isCurrent = i === stages.length - 1;
            const lbl = STAGE_LABELS[s.proceeding_type] || 'مرحلة';
            return `
            <div class="stage-history-card ${isCurrent ? 'current' : ''}">
            <div class="stage-header">
            <h5>${isCurrent ? '📍 ' : ''}المرحلة ${i + 1}: ${lbl}</h5>
            <span class="badge bg-${isCurrent ? 'success' : 'secondary'}">
            ${isCurrent ? 'الحالية' : 'سابقة'}
            </span>
            </div>
            <div class="stage-meta">
            <div><strong>الرقم:</strong> ${esc(s.case_number || '')}/${esc(s.case_year || '')}</div>
            <div><strong>المحكمة:</strong> ${esc(s.court_name || '-')}</div>
            <div><strong>الدائرة:</strong> ${esc(s.circuit || '-')}</div>
            <div><strong>صفة العميل:</strong> ${esc(s.client_role || '-')}</div>
            <div><strong>صفة الخصم:</strong> ${esc(s.opponent_role || '-')}</div>
            <div><strong>الحالة:</strong> ${esc(s.status || 'جديدة')}</div>
            <div style="grid-column:1/-1;"><strong>الكود:</strong> ${esc(s.case_code || '')}</div>
            ${s.judgment_date ? `<div style="grid-column:1/-1;"><strong>تاريخ الحكم:</strong> ${esc(s.judgment_date)}</div>` : ''}
            ${s.judgment_summary ? `<div class="judgment-box"><strong>منطوق الحكم:</strong><br>${esc(s.judgment_summary)}</div>` : ''}
            </div>
            <div style="margin-top:10px;">
            <button class="btn btn-sm btn-outline-primary"
            onclick="hideModal('stageHistoryModal'); openCaseDetails('${s.id}')">
            <i class="bi bi-box-arrow-up-left"></i> فتح المرحلة
            </button>
            </div>
            </div>
            `;
          }).join('');

          document.getElementById('stageHistoryBody').innerHTML =
          html || '<div class="text-muted">لا توجد مراحل مسجلة.</div>';
          window.showModal('stageHistoryModal');
        };

        /* ---- 8) addCaseStage → إعادة توجيه للدالة الجديدة ---- */
        window.addCaseStage = function (parentId) {
          return window.openAddStageModal(parentId);
        };

        console.log('%c[qayd-patch] ✅ تم تفعيل المراحل القضائية بنجاح (v' + PATCH_VERSION + ')',
                    'color:#16a34a; font-weight:bold;');
  }

  /* ============================================================
   * BOOT
   * ============================================================ */
  function boot() {
    injectStyles();
    injectModals();
    injectJudgmentFields();
    // تأخير بسيط لضمان تحميل renderer.js أولاً
    setTimeout(patchFunctions, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
