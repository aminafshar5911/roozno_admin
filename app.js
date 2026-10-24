/* Roozno Admin frontend. Only the public Supabase key belongs here. */
(() => {
  'use strict';
  const SUPABASE_URL = 'https://bqzrvmnzgytjpdlxbtup.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hKjX142K3-bMnD8qnRlXKw_BCzYkU3T';
  const $ = (s) => document.querySelector(s);
  let client = null, currentUser = null, users = [], activeAction = null;
  const state = { alerts: [], audit: [] };
  const loginView = $('#loginView'), adminView = $('#adminView');
  function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fa(v) { return new Intl.NumberFormat('fa-IR').format(v ?? 0); }
  let toastTimer;
  function toast(message, error=false) { const el=$('#globalStatus'); el.textContent=message;el.className='global-status show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='global-status',5000); }
  function setLoginStatus(s) { $('#loginStatus').textContent=s||''; }
  function showLogin() { loginView.classList.remove('hidden');adminView.classList.add('hidden');$('#logoutBtn').classList.add('hidden');$('#adminIdentity').textContent='وارد نشده‌اید'; }
  function showAdmin() { loginView.classList.add('hidden');adminView.classList.remove('hidden');$('#logoutBtn').classList.remove('hidden');$('#adminIdentity').textContent=currentUser?.email||'مدیر مجاز'; }
  async function api(action, payload={}) {
    const {data:{session},error:sessionError}=await client.auth.getSession();
    if(sessionError||!session?.access_token) throw new Error('نشست ورود معتبر نیست؛ دوباره وارد شوید.');
    const response=await fetch(`${SUPABASE_URL}/functions/v1/roozno_admin`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`,'apikey':SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify({action,...payload})});
    const body=await response.json().catch(()=>({error:'پاسخ سرور قابل خواندن نیست.'}));
    if(!response.ok||body.error) throw new Error(body.error||'درخواست ناموفق بود.');
    return body;
  }
  async function login() {
    if(!client) return setLoginStatus('تنظیمات Supabase بارگذاری نشده است.');
    setLoginStatus('در حال انتقال به ورود گوگل…');
    const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.href.split('#')[0],queryParams:{access_type:'online',prompt:'select_account'}}});
    if(error) setLoginStatus('ورود انجام نشد: '+error.message);
  }
  async function refreshAll() { await Promise.all([loadUsers(),loadAlerts(),loadAudit()]); }
  async function loadUsers() {
    $('#usersList').innerHTML='<div class="empty">در حال دریافت کاربران…</div>';
    try { const data=await api('list_users'); users=data.users||[];renderUsers();$('#userCount').textContent=fa(users.length); }
    catch(e){$('#usersList').innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`;toast(e.message,true);}
  }
  function renderUsers() {
    const q=$('#userSearch').value.trim().toLocaleLowerCase();
    const rows=users.filter(u=>[u.email,u.id,u.display_name].some(x=>String(x||'').toLocaleLowerCase().includes(q)));
    $('#userSearchCount').textContent=`${fa(rows.length)} نتیجه`;
    if(!rows.length){$('#usersList').innerHTML='<div class="empty">کاربری مطابق جست‌وجو پیدا نشد.</div>';return;}
    $('#usersList').innerHTML=`<table class="data-table"><thead><tr><th>کاربر</th><th>XP کل</th><th>وضعیت</th><th>عضویت</th><th>عملیات</th></tr></thead><tbody>${rows.map(u=>`<tr><td class="name-cell"><b>${escapeHtml(u.display_name||'کاربر روزنو')}</b><small>${escapeHtml(u.email||u.id)}<br>${escapeHtml(u.id)}</small></td><td>${fa(u.lifetime_xp||0)}</td><td><span class="pill ${u.banned?'open':''}">${u.banned?'مسدود':'عادی'}</span></td><td>${escapeHtml(u.created_at?new Date(u.created_at).toLocaleDateString('fa-IR'):'—')}</td><td><div class="actions"><button class="mini-btn" data-action="xp" data-id="${escapeHtml(u.id)}">تغییر XP</button><button class="mini-btn" data-action="warn" data-id="${escapeHtml(u.id)}">هشدار</button><button class="mini-btn ${u.banned?'':'danger'}" data-action="${u.banned?'unban':'ban'}" data-id="${escapeHtml(u.id)}">${u.banned?'رفع مسدودی':'مسدودسازی'}</button></div></td></tr>`).join('')}</tbody></table>`;
  }
  async function loadAlerts() {
    $('#alertsList').innerHTML='<div class="empty">در حال دریافت هشدارها…</div>';
    try {const d=await api('list_alerts');state.alerts=d.alerts||[];$('#alertCount').textContent=fa(state.alerts.filter(a=>!a.reviewed_at).length);$('#alertsList').innerHTML=state.alerts.length?`<table class="data-table"><thead><tr><th>زمان</th><th>کاربر</th><th>دلیل</th><th>شواهد</th><th>وضعیت</th><th></th></tr></thead><tbody>${state.alerts.map(a=>`<tr><td>${escapeHtml(new Date(a.created_at).toLocaleString('fa-IR'))}</td><td>${escapeHtml(a.user_id||'—')}</td><td>${escapeHtml(a.reason)}</td><td>${escapeHtml(JSON.stringify(a.evidence||{}).slice(0,240))}</td><td><span class="pill ${a.reviewed_at?'done':'open'}">${a.reviewed_at?'بررسی‌شده':'باز'}</span></td><td>${a.reviewed_at?'':`<button class="mini-btn" data-review-alert="${a.id}">ثبت بررسی</button>`}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">هشداری ثبت نشده است. توجه: تشخیص خودکار تقلب در نسخهٔ فعلی هنوز پیاده‌سازی نشده.</div>';}
    catch(e){$('#alertsList').innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`;}
  }
  async function loadAudit() {
    $('#auditList').innerHTML='<div class="empty">در حال دریافت گزارش…</div>';
    try {const d=await api('list_audit');state.audit=d.entries||[];$('#auditCount').textContent=fa(state.audit.length);$('#auditList').innerHTML=state.audit.length?`<table class="data-table"><thead><tr><th>زمان</th><th>مدیر</th><th>عملیات</th><th>هدف</th><th>دلیل</th><th>جزئیات</th></tr></thead><tbody>${state.audit.map(a=>`<tr><td>${escapeHtml(new Date(a.created_at).toLocaleString('fa-IR'))}</td><td>${escapeHtml(a.admin_email)}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.target_user_id||'—')}</td><td>${escapeHtml(a.reason||'—')}</td><td>${escapeHtml(JSON.stringify(a.details||{}).slice(0,180))}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">هنوز اقدامی ثبت نشده است.</div>';}
    catch(e){$('#auditList').innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`;}
  }
  function openAction(kind,id) {
    const user=users.find(u=>u.id===id);if(!user)return;
    const meta={xp:['تغییر XP','مقدار مثبت XP اضافه و مقدار منفی از XP کم می‌کند.','XP'],warn:['ثبت هشدار برای کاربر','این اقدام یک هشدار قابل بررسی ثبت می‌کند.','WARN'],ban:['مسدودسازی حساب','این اقدام ورود حساب را مسدود می‌کند. ممکن است نشست‌های موجود تا پایان اعتبار توکن کاملاً قطع نشوند.','BAN'],unban:['رفع مسدودی حساب','دسترسی ورود حساب دوباره فعال می‌شود.','UNBAN']};
    const m=meta[kind];activeAction={kind,id,email:user.email};$('#dialogTitle').textContent=m[0];$('#dialogUser').textContent=`${user.display_name||'کاربر روزنو'} · ${user.email||id} · ${id}`;$('#actionReason').value='';$('#amountGroup').classList.toggle('hidden',kind!=='xp');$('#dialogWarning').textContent=m[1];$('#confirmAction').textContent=m[2]==='BAN'?'مسدودسازی':m[2]==='UNBAN'?'رفع مسدودی':'تأیید اقدام';$('#userDialog').showModal();
  }
  async function confirmUserAction() {
    if(!activeAction)return;const reason=$('#actionReason').value.trim();if(reason.length<4){toast('لطفاً دلیل روشن و حداقل ۴ نویسه وارد کنید.',true);return;}
    const {kind,id}=activeAction;const btn=$('#confirmAction');btn.disabled=true;
    try {let payload={user_id:id,reason};if(kind==='xp'){const amount=Number($('#xpAmount').value);if(!Number.isInteger(amount)||amount===0||Math.abs(amount)>10000)throw new Error('مقدار XP باید عدد صحیح غیرصفر بین ۱ و ۱۰٬۰۰۰ یا منفی آن باشد.');payload.amount=amount;}
      await api(({xp:'adjust_xp',warn:'warn_user',ban:'ban_user',unban:'unban_user'})[kind],payload);$('#userDialog').close();toast('اقدام انجام شد و در گزارش مدیریتی ثبت شد.');await refreshAll();
    } catch(e){toast(e.message,true);} finally{btn.disabled=false;}
  }
  async function reviewAlert(id) {const reason=prompt('نتیجهٔ بررسی را بنویسید:');if(!reason||reason.trim().length<4)return;try{await api('review_alert',{alert_id:Number(id),reason:reason.trim()});toast('بررسی ثبت شد.');await Promise.all([loadAlerts(),loadAudit()]);}catch(e){toast(e.message,true);}}
  function setTab(tab) {document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));for(const name of ['users','alerts','audit'])$('#'+name+'Panel').classList.toggle('hidden',name!==tab);}
  async function init() {
    if(!window.supabase){setLoginStatus('کتابخانهٔ Supabase بارگذاری نشد؛ اتصال اینترنت را بررسی کنید.');return;}
    client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data:{session}}=await client.auth.getSession();if(session){currentUser=session.user;await establishAdminView();}else showLogin();
    client.auth.onAuthStateChange((event,session)=>{setTimeout(async()=>{if(session){currentUser=session.user;await establishAdminView();}else{currentUser=null;showLogin();}},0);});
    $('#loginBtn').addEventListener('click',login);$('#logoutBtn').addEventListener('click',async()=>{await client.auth.signOut();showLogin();});
    $('#refreshUsers').addEventListener('click',loadUsers);$('#refreshAlerts').addEventListener('click',loadAlerts);$('#refreshAudit').addEventListener('click',loadAudit);$('#userSearch').addEventListener('input',renderUsers);
    document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
    $('#usersList').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)openAction(b.dataset.action,b.dataset.id);});
    $('#alertsList').addEventListener('click',e=>{const b=e.target.closest('[data-review-alert]');if(b)reviewAlert(b.dataset.reviewAlert);});
    $('#confirmAction').addEventListener('click',confirmUserAction);$('#cancelAction').addEventListener('click',()=>$('#userDialog').close());$('#userActionForm').addEventListener('submit',e=>e.preventDefault());
  }
  async function establishAdminView(){showAdmin();try{await api('whoami');setLoginStatus('');await refreshAll();}catch(e){await client.auth.signOut();showLogin();setLoginStatus(e.message);}}
  document.addEventListener('DOMContentLoaded',init);
})();
