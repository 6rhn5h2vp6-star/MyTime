(() => {
"use strict";

const STATE_KEY = "mytime_final_state_v1";
const SETTINGS_KEY = "mytime_final_settings_v1";
const OLD_STATE_KEYS = ["mytime_pro_v2_state","mytime_ultimate_v1","mytime_complete_v1"];
const OLD_SETTINGS_KEYS = ["mytime_pro_v2_settings","mytime_ultimate_settings_v1","mytime_complete_settings_v1"];

const defaultState = { active:null, records:[], todayJobs:[], gps:null, shifts:[], routes:[], deletedRecords:[], activeWorkplaceId:"workplace-1" };
const defaultSettings = {
  name:"", theme:"dark", pin:"", sheetUrl:"", autoSend:"off",
  workplaces:[
    {id:"workplace-1",name:"勤務先1",wage:1200,standardHours:8,overtimeRate:1.25,nightRate:1.25,holidayRate:1.35}
  ]
};

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2,"0");
const clone = (x) => JSON.parse(JSON.stringify(x));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

function safeParse(value, fallback){
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
function loadWithMigration(currentKey, oldKeys, fallback){
  const current = safeParse(localStorage.getItem(currentKey), null);
  if(current) return current;
  for(const key of oldKeys){
    const old = safeParse(localStorage.getItem(key), null);
    if(old){
      localStorage.setItem(currentKey, JSON.stringify(old));
      return old;
    }
  }
  return clone(fallback);
}

let state = Object.assign(clone(defaultState), loadWithMigration(STATE_KEY, OLD_STATE_KEYS, defaultState));
let settings = Object.assign(clone(defaultSettings), loadWithMigration(SETTINGS_KEY, OLD_SETTINGS_KEYS, defaultSettings));

state.records = Array.isArray(state.records) ? state.records : [];
state.todayJobs = Array.isArray(state.todayJobs) ? state.todayJobs : [];
state.shifts = Array.isArray(state.shifts) ? state.shifts : [];
state.routes = Array.isArray(state.routes) ? state.routes : [];
state.deletedRecords = Array.isArray(state.deletedRecords) ? state.deletedRecords : [];
settings.workplaces = Array.isArray(settings.workplaces) && settings.workplaces.length ? settings.workplaces : [{
  id:"workplace-1",
  name:"勤務先1",
  wage:Number(settings.wage||1200),
  standardHours:Number(settings.standardHours||8),
  overtimeRate:Number(settings.overtimeRate||1.25),
  nightRate:Number(settings.nightRate||1.25),
  holidayRate:Number(settings.holidayRate||1.35)
}];
state.activeWorkplaceId = state.activeWorkplaceId || settings.workplaces[0].id;
const fallbackWorkplaceId = settings.workplaces[0].id;
state.records.forEach(r=>{ if(!r.workplaceId) r.workplaceId=fallbackWorkplaceId; });
state.shifts.forEach(s=>{ if(!s.workplaceId) s.workplaceId=fallbackWorkplaceId; });
if(state.active && !state.active.workplaceId) state.active.workplaceId=state.activeWorkplaceId;


function activeWorkplace(){
  return settings.workplaces.find(w=>w.id===state.activeWorkplaceId) || settings.workplaces[0];
}
function workplaceById(id){
  return settings.workplaces.find(w=>w.id===id) || settings.workplaces[0];
}
function workplaceName(id){
  return workplaceById(id)?.name || "勤務先";
}
function recordWorkplace(record){
  return workplaceById(record?.workplaceId || state.activeWorkplaceId);
}

function persist(){
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}
function persistSettings(){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function toast(message){
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 1800);
}
function dateKey(value){
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function timeInput(ms){
  if(!ms) return "";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function timeJapanese(ms){
  if(!ms) return "未記録";
  const d = new Date(ms);
  return `${d.getHours()}時${pad(d.getMinutes())}分`;
}
function minutesText(minutes){
  const value = Math.max(0, Math.floor(Number(minutes)||0));
  return `${Math.floor(value/60)}時間${pad(value%60)}分`;
}
function money(value){
  return new Intl.NumberFormat("ja-JP",{style:"currency",currency:"JPY",maximumFractionDigits:0}).format(value||0);
}
function breakMinutes(record, end = Date.now()){
  if(!record) return 0;
  if(record.manualBreakMinutes !== undefined && record.manualBreakMinutes !== null){
    return Math.max(0, Number(record.manualBreakMinutes)||0);
  }
  return Math.floor((record.breaks||[]).reduce((sum,b) => {
    return sum + Math.max(0, (b.end || end) - b.start);
  },0)/60000);
}
function workMinutes(record, end = Date.now()){
  if(!record?.clockIn) return 0;
  const finish = record.clockOut || end;
  return Math.max(0, Math.floor((finish-record.clockIn)/60000)-breakMinutes(record,finish));
}
function overtimeMinutes(record){
  const workplace=recordWorkplace(record); return Math.max(0, workMinutes(record,record?.clockOut)-Number(workplace.standardHours||8)*60);
}
function nightMinutes(record){
  if(!record?.clockIn || !record?.clockOut) return 0;
  let result = 0;
  for(let t=record.clockIn; t<record.clockOut; t+=60000){
    const hour = new Date(t).getHours();
    if(hour >= 22 || hour < 5) result++;
  }
  return result;
}
function holiday(record){
  const day = new Date(record.clockIn).getDay();
  return day===0 || day===6;
}
function estimatedPay(record){
  const workplace=recordWorkplace(record);
  const wage = Number(workplace.wage||0);
  const total = workMinutes(record,record.clockOut);
  const overtime = overtimeMinutes(record);
  const regular = Math.max(0,total-overtime);
  const night = nightMinutes(record);
  const holidayMinutes = holiday(record) ? total : 0;
  return Math.round(
    regular/60*wage +
    overtime/60*wage*Number(workplace.overtimeRate||1.25) +
    night/60*wage*(Number(workplace.nightRate||1.25)-1) +
    holidayMinutes/60*wage*(Number(workplace.holidayRate||1.35)-1)
  );
}
function todayRecord(){
  const today = dateKey(new Date());
  if(state.active && dateKey(state.active.clockIn)===today) return state.active;
  return [...state.records].reverse().find(r => dateKey(r.clockIn)===today && r.workplaceId===state.activeWorkplaceId) || null;
}
function totalJobs(jobs=state.todayJobs){
  return (jobs||[]).reduce((sum,j)=>sum+Number(j.install||0),0);
}
function productSummary(job){
  const items=[];
  if(job.tv) items.push(`テレビ${job.tv}`);
  if(job.fridge) items.push(`冷蔵庫${job.fridge}`);
  if(job.washer) items.push(`洗濯機${job.washer}`);
  if(job.aircon) items.push(`エアコン${job.aircon}`);
  if(job.microwave) items.push(`電子レンジ${job.microwave}`);
  if(job.otherName && job.otherCount) items.push(`${job.otherName}${job.otherCount}`);
  items.push(`配設${job.install||0}件`);
  return items.join("");
}
function reportFor(record, jobs){
  const base = record?.clockIn ? new Date(record.clockIn) : new Date();
  const weekday = ["日","月","火","水","木","金","土"][base.getDay()];
  const lines = [
    `${base.getMonth()+1}月${base.getDate()}日（${weekday}曜日）`,
    `勤務先：${workplaceName(record?.workplaceId || state.activeWorkplaceId)}`,
    `出社${record?.clockIn ? timeJapanese(record.clockIn) : "未記録"}`,
    `退社${record?.clockOut ? timeJapanese(record.clockOut) : "未記録"}`,
    "業務内容"
  ];
  const numerals=["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩"];
  (jobs||[]).forEach((job,index)=>{
    let line = `${numerals[index]||`${index+1}.`}${productSummary(job)}`;
    if(job.customer) line += `（${job.customer}）`;
    lines.push(line);
    if(job.note) lines.push(`　備考：${job.note}`);
  });
  lines.push(`合計${totalJobs(jobs)}件`);
  return lines.join("\n");
}
function applyTheme(){
  document.documentElement.dataset.theme = settings.theme || "dark";
}
function showPage(name){
  document.querySelectorAll(".page").forEach(el=>el.classList.toggle("active",el.id===`page-${name}`));
  document.querySelectorAll(".tab").forEach(el=>el.classList.toggle("active",el.dataset.page===name));
  if(name==="report") generateReport();
  if(name==="analytics") renderAnalytics();
}

function renderWorkplaceSelectors(){
  const options=settings.workplaces.map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join("");
  $("workplaceSwitcher").innerHTML=options;
  $("workplaceSwitcher").value=state.activeWorkplaceId;
  $("filterWorkplace").innerHTML=`<option value="all">すべて</option>${options}`;
  if(!$("filterWorkplace").value) $("filterWorkplace").value="all";
  $("monthWorkplace").innerHTML=`<option value="all">全勤務先</option>${options}`;
  if(!$("monthWorkplace").value) $("monthWorkplace").value="all";
  $("shiftWorkplace").innerHTML=options;
  $("shiftWorkplace").value=state.activeWorkplaceId;
  $("activeWorkplaceLabel").textContent=activeWorkplace().name;
}
function renderWorkplaceSettings(){
  const host=$("workplaceSettingsList");
  host.innerHTML=settings.workplaces.map((w,index)=>`
    <article class="workplace-setting-card">
      <div class="job-card-head">
        <strong>勤務先 ${index+1}</strong>
        ${settings.workplaces.length>1?`<button class="remove-button" data-remove-workplace="${w.id}">削除</button>`:""}
      </div>
      <div class="field-grid">
        <label>勤務先名<input data-workplace="${w.id}" data-wfield="name" value="${escapeHtml(w.name)}"></label>
        <label>時給<input type="number" min="0" data-workplace="${w.id}" data-wfield="wage" value="${w.wage}"></label>
        <label>所定労働時間<input type="number" min="0" step="0.25" data-workplace="${w.id}" data-wfield="standardHours" value="${w.standardHours}"></label>
        <label>残業割増率<input type="number" min="1" step="0.01" data-workplace="${w.id}" data-wfield="overtimeRate" value="${w.overtimeRate}"></label>
        <label>深夜割増率<input type="number" min="1" step="0.01" data-workplace="${w.id}" data-wfield="nightRate" value="${w.nightRate}"></label>
        <label>休日割増率<input type="number" min="1" step="0.01" data-workplace="${w.id}" data-wfield="holidayRate" value="${w.holidayRate}"></label>
      </div>
    </article>`).join("");
  host.querySelectorAll("[data-workplace][data-wfield]").forEach(input=>{
    input.oninput=()=>{
      const w=settings.workplaces.find(x=>x.id===input.dataset.workplace);
      const field=input.dataset.wfield;
      w[field]=field==="name"?input.value:Number(input.value||0);
    };
  });
  host.querySelectorAll("[data-remove-workplace]").forEach(button=>{
    button.onclick=()=>{
      const id=button.dataset.removeWorkplace;
      if(state.records.some(r=>r.workplaceId===id)){toast("この勤務先には勤怠履歴があるため削除できません");return;}
      if(!confirm("この勤務先を削除しますか？")) return;
      settings.workplaces=settings.workplaces.filter(w=>w.id!==id);
      if(state.activeWorkplaceId===id) state.activeWorkplaceId=settings.workplaces[0].id;
      persist();persistSettings();renderAll();fillSettings();
    };
  });
}

function updateClock(){
  const now = new Date();
  $("clock").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  $("todayDate").textContent = new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(now);
  $("reportDate").textContent = new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(now);
  const record = todayRecord();
  $("todayWork").textContent = minutesText(workMinutes(record));
  $("todayOvertime").textContent = `${overtimeMinutes(record)}分`;
}
function renderPunchState(){
  const openBreak = state.active?.breaks?.find(b=>!b.end);
  $("clockInButton").disabled = Boolean(state.active);
  $("clockOutButton").disabled = !state.active || Boolean(openBreak);
  $("breakButton").disabled = !state.active;
  $("statusDot").className = "status-dot";
  if(!state.active){
    $("statusText").textContent = "未出勤";
    $("breakButton").textContent = "休憩を開始";
  } else if(openBreak){
    $("statusText").textContent = "休憩中";
    $("statusDot").classList.add("breaking");
    $("breakButton").textContent = "休憩を終了";
  } else {
    $("statusText").textContent = "勤務中";
    $("statusDot").classList.add("working");
    $("breakButton").textContent = "休憩を開始";
  }
}
function renderToday(){
  const record = todayRecord();
  $("todayClockIn").textContent = record?.clockIn ? timeJapanese(record.clockIn) : "未記録";
  $("todayClockOut").textContent = record?.clockOut ? timeJapanese(record.clockOut) : "未記録";
  $("todayJobCount").textContent = `${totalJobs(state.todayJobs)}件`;
  $("gpsStatus").textContent = state.gps ? `GPS：${state.gps.lat.toFixed(5)}, ${state.gps.lng.toFixed(5)}（精度 約${Math.round(state.gps.accuracy||0)}m）` : "GPS：未取得";
}
function emptyJob(){
  return {id:uid(),customer:"",address:"",tv:0,fridge:0,washer:0,aircon:0,microwave:0,otherName:"",otherCount:0,install:1,note:""};
}
function ensureJob(){
  if(!state.todayJobs.length) state.todayJobs.push(emptyJob());
}
function counterField(index,key,value,label){
  return `<label>${label}<div class="counter"><button type="button" data-counter="${index}" data-key="${key}" data-delta="-1">−</button><input type="number" min="0" value="${Number(value)||0}" data-job="${index}" data-field="${key}"><button type="button" data-counter="${index}" data-key="${key}" data-delta="1">＋</button></div></label>`;
}
function renderRoutes(){
  const host=$("routeHistory");
  const unique=[];
  const seen=new Set();
  [...state.routes,...state.records.flatMap(r=>(r.jobs||[]).map(j=>({customer:j.customer,address:j.address})))].forEach(r=>{
    const key=`${r.customer||""}|${r.address||""}`;
    if(key!=="|"&&!seen.has(key)){seen.add(key);unique.push(r);}
  });
  state.routes=unique.slice(0,20);
  host.innerHTML = state.routes.length
    ? `<p class="small-note">配送先履歴</p>${state.routes.slice(0,8).map((r,i)=>`<button class="route-chip" data-route="${i}">${r.customer||r.address}</button>`).join("")}`
    : "";
  host.querySelectorAll("[data-route]").forEach(button=>{
    button.onclick=()=>{
      ensureJob();
      const route=state.routes[Number(button.dataset.route)];
      const job=state.todayJobs[state.todayJobs.length-1];
      job.customer=route.customer||"";
      job.address=route.address||"";
      persist();renderJobs();toast("配送先を入力しました");
    };
  });
}
function renderJobs(){
  ensureJob();
  const host=$("jobList");
  host.innerHTML=state.todayJobs.map((job,index)=>`
    <article class="job-card">
      <div class="job-card-head"><strong>案件 ${index+1}</strong><button class="remove-button" data-remove-job="${index}">削除</button></div>
      <div class="field-grid">
        <label>案件名・お客様名<input value="${escapeHtml(job.customer)}" data-job="${index}" data-field="customer"></label>
        <label>配送先<input value="${escapeHtml(job.address)}" data-job="${index}" data-field="address"></label>
        ${counterField(index,"tv",job.tv,"テレビ")}
        ${counterField(index,"fridge",job.fridge,"冷蔵庫")}
        ${counterField(index,"washer",job.washer,"洗濯機")}
        ${counterField(index,"aircon",job.aircon,"エアコン")}
        ${counterField(index,"microwave",job.microwave,"電子レンジ")}
        <label>その他品名<input value="${escapeHtml(job.otherName)}" data-job="${index}" data-field="otherName"></label>
        ${counterField(index,"otherCount",job.otherCount,"その他台数")}
        ${counterField(index,"install",job.install,"配送設置件数")}
        <label class="wide">メモ<textarea data-job="${index}" data-field="note">${escapeHtml(job.note)}</textarea></label>
      </div>
    </article>`).join("");

  host.querySelectorAll("[data-job][data-field]").forEach(input=>{
    input.oninput=()=>{
      const job=state.todayJobs[Number(input.dataset.job)];
      const field=input.dataset.field;
      const textFields=["customer","address","otherName","note"];
      job[field]=textFields.includes(field)?input.value:Number(input.value||0);
      persist();renderToday();
    };
  });
  host.querySelectorAll("[data-counter]").forEach(button=>{
    button.onclick=()=>{
      const job=state.todayJobs[Number(button.dataset.counter)];
      const key=button.dataset.key;
      job[key]=Math.max(0,Number(job[key]||0)+Number(button.dataset.delta));
      persist();renderJobs();renderToday();
    };
  });
  host.querySelectorAll("[data-remove-job]").forEach(button=>{
    button.onclick=()=>{
      if(state.todayJobs.length===1){toast("案件は最低1件残してください");return;}
      if(confirm("この案件を削除しますか？")){
        state.todayJobs.splice(Number(button.dataset.removeJob),1);
        persist();renderJobs();renderToday();
      }
    };
  });
  renderRoutes();
}
function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function generateReport(){
  $("reportOutput").value=reportFor(todayRecord(),state.todayJobs);
}
function storeCurrentReport(){
  const record=todayRecord();
  if(!record){toast("先に出勤を記録してください");return false;}
  record.jobs=clone(state.todayJobs);
  record.report=$("reportOutput").value||reportFor(record,state.todayJobs);
  record.gps=state.gps?clone(state.gps):null;
  state.todayJobs.forEach(job=>{
    if(job.customer||job.address){
      const key=`${job.customer}|${job.address}`;
      if(!state.routes.some(r=>`${r.customer}|${r.address}`===key)) state.routes.unshift({customer:job.customer,address:job.address});
    }
  });
  if(!state.active){
    const index=state.records.findIndex(r=>r.id===record.id);
    if(index>=0) state.records[index]=record;
  }
  persist();renderAll();return true;
}
function filteredRecords(){
  const workplace=$("filterWorkplace").value;
  const from=$("filterFrom").value;
  const to=$("filterTo").value;
  const query=$("filterQuery").value.trim().toLowerCase();
  return state.records.filter(record=>{
    const day=dateKey(record.clockIn);
    if(workplace!=="all" && record.workplaceId!==workplace) return false;
    if(from&&day<from) return false;
    if(to&&day>to) return false;
    if(query&&!JSON.stringify(record.jobs||[]).toLowerCase().includes(query)) return false;
    return true;
  }).sort((a,b)=>b.clockIn-a.clockIn);
}

let pendingUndo = null;

function deleteRecord(id){
  const index = state.records.findIndex(record=>record.id===id);
  if(index<0) return;
  const record = state.records[index];
  const reason = prompt("削除理由を入力してください", "誤って登録したため");
  if(reason===null) return;
  if(!reason.trim()){ toast("削除理由を入力してください"); return; }
  if(!confirm(`${dateKey(record.clockIn)} の勤怠を削除しますか？`)) return;

  const deletedAt = Date.now();
  const tombstone = {
    id: uid(),
    deletedAt,
    reason: reason.trim(),
    record: clone(record)
  };

  state.records.splice(index,1);
  state.deletedRecords.unshift(tombstone);
  pendingUndo = { tombstoneId:tombstone.id, expiresAt:Date.now()+30000 };
  persist();
  renderAll();
  showUndoToast("勤怠を削除しました。30秒以内なら元に戻せます");
}

function undoDelete(){
  if(!pendingUndo || Date.now()>pendingUndo.expiresAt){
    pendingUndo=null;
    toast("元に戻せる時間を過ぎました");
    return;
  }
  const index = state.deletedRecords.findIndex(item=>item.id===pendingUndo.tombstoneId);
  if(index<0) return;
  const item = state.deletedRecords[index];
  state.records.push(item.record);
  state.deletedRecords.splice(index,1);
  pendingUndo=null;
  persist();
  renderAll();
  toast("削除した勤怠を元に戻しました");
}

function showUndoToast(message){
  const el=$("toast");
  el.innerHTML=`${escapeHtml(message)} <button id="undoDeleteButton" class="undo-button">元に戻す</button>`;
  el.classList.add("show");
  clearTimeout(toast.timer);
  $("undoDeleteButton").onclick=undoDelete;
  toast.timer=setTimeout(()=>{
    el.classList.remove("show");
    pendingUndo=null;
  },30000);
}

function renderDeletedHistory(){
  const host=$("deletedHistory");
  if(!host) return;
  const items=state.deletedRecords.slice(0,20);
  host.innerHTML=items.length?items.map(item=>`
    <div class="audit-item">
      <strong>${dateKey(item.record.clockIn)} の勤怠</strong>
      <div>削除日時：${new Date(item.deletedAt).toLocaleString("ja-JP")}</div>
      <div>理由：${escapeHtml(item.reason)}</div>
      <p class="small-note">出社 ${timeInput(item.record.clockIn)} ／ 退社 ${timeInput(item.record.clockOut)} ／ 実働 ${minutesText(workMinutes(item.record,item.record.clockOut))}</p>
      <button class="button compact ghost" data-restore-deleted="${item.id}">復元</button>
    </div>`).join(""):`<div class="empty-state">削除履歴はありません</div>`;
  host.querySelectorAll("[data-restore-deleted]").forEach(button=>{
    button.onclick=()=>{
      const idx=state.deletedRecords.findIndex(item=>item.id===button.dataset.restoreDeleted);
      if(idx<0) return;
      const item=state.deletedRecords[idx];
      state.records.push(item.record);
      state.deletedRecords.splice(idx,1);
      persist();
      renderAll();
      toast("削除履歴から復元しました");
    };
  });
}

function renderHistory(){
  const host=$("historyTable");
  const records=filteredRecords();
  host.innerHTML=records.length?records.map(record=>`
    <tr>
      <td>${escapeHtml(workplaceName(record.workplaceId))}</td><td>${dateKey(record.clockIn)}</td><td>${timeInput(record.clockIn)}</td><td>${timeInput(record.clockOut)||"-"}</td>
      <td>${minutesText(workMinutes(record,record.clockOut))}</td><td>${minutesText(overtimeMinutes(record))}</td>
      <td>${totalJobs(record.jobs||[])}件</td><td>${money(estimatedPay(record))}</td>
      <td><div class="table-actions"><button class="button compact ghost" data-edit="${record.id}">修正</button><button class="button compact ghost" data-audit="${record.id}">履歴</button><button class="button compact danger" data-delete-record="${record.id}">削除</button></div></td>
    </tr>`).join(""):`<tr><td colspan="9"><div class="empty-state">履歴がありません</div></td></tr>`;
  host.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openEdit(b.dataset.edit));
  host.querySelectorAll("[data-audit]").forEach(b=>b.onclick=()=>openAudit(b.dataset.audit));
  host.querySelectorAll("[data-delete-record]").forEach(b=>b.onclick=()=>deleteRecord(b.dataset.deleteRecord));
}
function openEdit(id){
  const record=state.records.find(r=>r.id===id);
  if(!record) return;
  $("editRecordId").value=id;
  $("editDate").value=dateKey(record.clockIn);
  $("editClockIn").value=timeInput(record.clockIn);
  $("editClockOut").value=timeInput(record.clockOut);
  $("editBreakMinutes").value=breakMinutes(record,record.clockOut);
  $("editReason").value="";
  $("editModal").classList.remove("hidden");
}
function saveEdit(){
  const record=state.records.find(r=>r.id===$("editRecordId").value);
  const reason=$("editReason").value.trim();
  if(!record) return;
  if(!reason){toast("修正理由を入力してください");return;}
  const date=$("editDate").value;
  const inTime=$("editClockIn").value;
  const outTime=$("editClockOut").value;
  if(!date||!inTime||!outTime){toast("日付と時刻を入力してください");return;}
  const newIn=new Date(`${date}T${inTime}:00`).getTime();
  let newOut=new Date(`${date}T${outTime}:00`).getTime();
  if(newOut<newIn) newOut+=86400000;
  const before={clockIn:record.clockIn,clockOut:record.clockOut,breakMinutes:breakMinutes(record,record.clockOut)};
  record.clockIn=newIn;
  record.clockOut=newOut;
  record.manualBreakMinutes=Math.max(0,Number($("editBreakMinutes").value)||0);
  record.audit=Array.isArray(record.audit)?record.audit:[];
  record.audit.push({at:Date.now(),reason,before,after:{clockIn:newIn,clockOut:newOut,breakMinutes:record.manualBreakMinutes}});
  record.report=reportFor(record,record.jobs||[]);
  persist();
  $("editModal").classList.add("hidden");
  renderAll();toast("勤怠を修正しました");
}
function openAudit(id){
  const record=state.records.find(r=>r.id===id);
  const list=record?.audit||[];
  $("auditList").innerHTML=list.length?list.slice().reverse().map(item=>`
    <div class="audit-item">
      <strong>${new Date(item.at).toLocaleString("ja-JP")}</strong>
      <div>${escapeHtml(item.reason)}</div>
      <p class="small-note">出社 ${timeInput(item.before.clockIn)} → ${timeInput(item.after.clockIn)} ／ 退社 ${timeInput(item.before.clockOut)} → ${timeInput(item.after.clockOut)} ／ 休憩 ${item.before.breakMinutes}分 → ${item.after.breakMinutes}分</p>
    </div>`).join(""):`<div class="empty-state">修正履歴はありません</div>`;
  $("auditModal").classList.remove("hidden");
}
function renderShifts(){
  const host=$("shiftTable");
  const sorted=[...state.shifts].sort((a,b)=>a.date.localeCompare(b.date));
  host.innerHTML=sorted.length?sorted.map(shift=>`
    <tr><td>${escapeHtml(workplaceName(shift.workplaceId))}</td><td>${shift.date}</td><td>${shift.start}</td><td>${shift.end}</td><td>${escapeHtml(shift.place)}</td><td>${escapeHtml(shift.note)}</td><td><button class="button compact ghost" data-delete-shift="${shift.id}">削除</button></td></tr>`).join("")
    :`<tr><td colspan="7"><div class="empty-state">シフトは未登録です</div></td></tr>`;
  host.querySelectorAll("[data-delete-shift]").forEach(b=>b.onclick=()=>{
    state.shifts=state.shifts.filter(s=>s.id!==b.dataset.deleteShift);persist();renderShifts();renderNextShift();
  });
}
function renderNextShift(){
  const today=dateKey(new Date());
  const shift=[...state.shifts].filter(s=>s.date>=today).sort((a,b)=>a.date.localeCompare(b.date))[0];
  $("nextShift").innerHTML=shift?`<div class="stat-grid"><div class="stat"><span>勤務先</span><strong>${escapeHtml(workplaceName(shift.workplaceId))}</strong></div><div class="stat"><span>日付</span><strong>${shift.date}</strong></div><div class="stat"><span>時間</span><strong>${shift.start}〜${shift.end}</strong></div><div class="stat"><span>場所</span><strong>${escapeHtml(shift.place||"-")}</strong></div><div class="stat"><span>メモ</span><strong>${escapeHtml(shift.note||"-")}</strong></div></div>`:"登録されたシフトはありません";
}
function monthRecords(){
  const ym=$("monthPicker").value;
  const workplace=$("monthWorkplace").value;
  return state.records.filter(r=>dateKey(r.clockIn).startsWith(ym) && (workplace==="all" || r.workplaceId===workplace));
}
function renderAnalytics(){
  if(!$("monthPicker").value) $("monthPicker").value=dateKey(new Date()).slice(0,7);
  const records=monthRecords();
  const work=records.reduce((s,r)=>s+workMinutes(r,r.clockOut),0);
  const overtime=records.reduce((s,r)=>s+overtimeMinutes(r),0);
  const night=records.reduce((s,r)=>s+nightMinutes(r),0);
  const jobs=records.reduce((s,r)=>s+totalJobs(r.jobs||[]),0);
  const pay=records.reduce((s,r)=>s+estimatedPay(r),0);
  $("monthDays").textContent=`${records.length}日`;
  $("monthHours").textContent=minutesText(work);
  $("monthOvertime").textContent=minutesText(overtime);
  $("monthNight").textContent=minutesText(night);
  $("monthJobs").textContent=`${jobs}件`;
  $("monthPay").textContent=money(pay);
  drawBars("hoursChart",records,r=>workMinutes(r,r.clockOut)/60,"日別 実働時間");
  drawBars("jobsChart",records,r=>totalJobs(r.jobs||[]),"日別 配送設置件数");
}
function drawBars(canvasId,records,valueFn,title){
  const canvas=$(canvasId),ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  const text=getComputedStyle(document.documentElement).getPropertyValue("--text").trim()||"#fff";
  ctx.fillStyle=text;ctx.font="700 24px sans-serif";ctx.fillText(title,24,34);
  if(!records.length){ctx.font="18px sans-serif";ctx.fillText("データなし",w/2-45,h/2);return;}
  const values=records.map(valueFn),max=Math.max(1,...values);
  const width=(w-80)/records.length;
  records.forEach((record,i)=>{
    const bar=Math.max(2,values[i]/max*(h-100));
    const x=52+i*width,y=h-42-bar;
    const gradient=ctx.createLinearGradient(0,y,0,h-42);
    gradient.addColorStop(0,"#9a6cff");gradient.addColorStop(1,"#5e78ff");
    ctx.fillStyle=gradient;ctx.fillRect(x,y,Math.max(8,width-10),bar);
    ctx.fillStyle=text;ctx.font="14px sans-serif";ctx.fillText(String(new Date(record.clockIn).getDate()),x,h-18);
  });
}
function exportCsv(){
  const rows=[["勤務先","日付","出社","退社","休憩分","実働分","残業分","深夜分","配設件数","概算給与"]];
  state.records.sort((a,b)=>a.clockIn-b.clockIn).forEach(r=>rows.push([
    workplaceName(r.workplaceId),dateKey(r.clockIn),timeInput(r.clockIn),timeInput(r.clockOut),breakMinutes(r,r.clockOut),
    workMinutes(r,r.clockOut),overtimeMinutes(r),nightMinutes(r),totalJobs(r.jobs||[]),estimatedPay(r)
  ]));
  downloadBlob("\uFEFF"+rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n"),`勤務履歴_${dateKey(new Date())}.csv`,"text/csv");
}
function backup(){
  downloadBlob(JSON.stringify({version:1,exportedAt:new Date().toISOString(),state,settings},null,2),`MyTime_backup_${dateKey(new Date())}.json`,"application/json");
}
function restore(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      if(!data.state||!data.settings) throw new Error();
      state=Object.assign(clone(defaultState),data.state);
      settings=Object.assign(clone(defaultSettings),data.settings);
      persist();persistSettings();location.reload();
    }catch{toast("バックアップファイルを読み込めませんでした");}
  };
  reader.readAsText(file);
}
function downloadBlob(content,name,type){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([content],{type}));
  a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function shareReport(){
  const text=$("reportOutput").value||reportFor(todayRecord(),state.todayJobs);
  try{
    if(navigator.share) await navigator.share({title:"業務日報",text});
    else {await navigator.clipboard.writeText(text);toast("日報をコピーしました");}
  }catch(error){if(error.name!=="AbortError") toast("共有できませんでした");}
}
async function sendSheet(){
  if(!settings.sheetUrl){toast("設定画面でApps Script URLを登録してください");return false;}
  const record=todayRecord();
  const payload={date:dateKey(record?.clockIn||Date.now()),name:settings.name,workplace:workplaceName(record?.workplaceId||state.activeWorkplaceId),clockIn:record?.clockIn||null,clockOut:record?.clockOut||null,workMinutes:workMinutes(record),jobs:state.todayJobs,totalJobs:totalJobs(),gps:state.gps,report:$("reportOutput").value||reportFor(record,state.todayJobs)};
  try{
    await fetch(settings.sheetUrl,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    toast("スプレッドシートへ送信しました");return true;
  }catch{toast("送信に失敗しました");return false;}
}
function createCalendarFile(){
  const record=todayRecord();
  if(!record?.clockIn){toast("勤務記録がありません");return;}
  const format=(ms)=>new Date(ms).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z/,"Z");
  const text=($("reportOutput").value||reportFor(record,state.todayJobs)).replace(/\n/g,"\\n").replace(/,/g,"\\,");
  const ics=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//MyTime PRO//JA\r\nBEGIN:VEVENT\r\nUID:${record.id}@mytime\r\nDTSTAMP:${format(Date.now())}\r\nDTSTART:${format(record.clockIn)}\r\nDTEND:${format(record.clockOut||Date.now())}\r\nSUMMARY:勤務 ${totalJobs()}件\r\nDESCRIPTION:${text}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  downloadBlob(ics,`勤務_${dateKey(record.clockIn)}.ics`,"text/calendar");
}
function fillSettings(){
  $("settingName").value=settings.name;
  $("settingTheme").value=settings.theme;
  $("settingPin").value=settings.pin;
  $("settingSheetUrl").value=settings.sheetUrl;
  $("settingAutoSend").value=settings.autoSend;
  renderWorkplaceSettings();
}
function saveSettings(){
  settings.name=$("settingName").value.trim();
  settings.theme=$("settingTheme").value;
  settings.pin=$("settingPin").value.trim();
  settings.sheetUrl=$("settingSheetUrl").value.trim();
  settings.autoSend=$("settingAutoSend").value;
  settings.workplaces.forEach(w=>{
    w.name=(w.name||"勤務先").trim()||"勤務先";
    w.wage=Number(w.wage||0);
    w.standardHours=Number(w.standardHours||8);
    w.overtimeRate=Number(w.overtimeRate||1.25);
    w.nightRate=Number(w.nightRate||1.25);
    w.holidayRate=Number(w.holidayRate||1.35);
  });
  persistSettings();applyTheme();renderAll();toast("設定を保存しました");
}
function lock(){
  if(!settings.pin){toast("設定画面でパスコードを登録してください");return;}
  $("unlockPin").value="";$("unlockError").textContent="";$("lockScreen").classList.remove("hidden");
}
function unlock(){
  if($("unlockPin").value===settings.pin){$("lockScreen").classList.add("hidden");$("unlockError").textContent="";}
  else $("unlockError").textContent="パスコードが違います";
}
function renderAll(){
  renderWorkplaceSelectors();renderPunchState();renderToday();renderJobs();renderHistory();renderDeletedHistory();renderShifts();renderNextShift();renderAnalytics();updateClock();
}

document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>showPage(b.dataset.go));
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add("hidden"));

$("workplaceSwitcher").onchange=()=>{
  if(state.active){toast("勤務中は勤務先を切り替えられません");$("workplaceSwitcher").value=state.activeWorkplaceId;return;}
  state.activeWorkplaceId=$("workplaceSwitcher").value;
  persist();renderAll();generateReport();toast(`${activeWorkplace().name}へ切り替えました`);
};
$("filterWorkplace").onchange=renderHistory;
$("monthWorkplace").onchange=renderAnalytics;
$("addWorkplaceButton").onclick=()=>{
  const id=uid();
  settings.workplaces.push({id,name:`勤務先${settings.workplaces.length+1}`,wage:1200,standardHours:8,overtimeRate:1.25,nightRate:1.25,holidayRate:1.35});
  state.activeWorkplaceId=id;
  persist();persistSettings();renderAll();fillSettings();toast("勤務先を追加しました");
};
$("themeButton").onclick=()=>{settings.theme=settings.theme==="dark"?"light":"dark";persistSettings();applyTheme();renderAnalytics();};
$("clockInButton").onclick=()=>{
  state.active={id:uid(),workplaceId:state.activeWorkplaceId,clockIn:Date.now(),clockOut:null,breaks:[],jobs:[],audit:[]};
  state.gps=null;persist();renderAll();toast("出勤を記録しました");
};
$("clockOutButton").onclick=async()=>{
  if(!state.active) return;
  state.active.clockOut=Date.now();
  state.active.jobs=clone(state.todayJobs);
  state.active.report=reportFor(state.active,state.todayJobs);
  state.active.gps=state.gps?clone(state.gps):null;
  state.records.push(state.active);
  state.active=null;
  persist();renderAll();generateReport();
  if(settings.autoSend==="on") await sendSheet();
  else toast("退勤と日報を保存しました");
};
$("breakButton").onclick=()=>{
  const open=state.active?.breaks?.find(b=>!b.end);
  if(open){open.end=Date.now();toast("休憩を終了しました");}
  else {state.active.breaks.push({start:Date.now(),end:null});toast("休憩を開始しました");}
  persist();renderAll();
};
$("gpsButton").onclick=()=>{
  if(!navigator.geolocation){toast("この端末ではGPSを利用できません");return;}
  navigator.geolocation.getCurrentPosition(pos=>{
    state.gps={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy,at:Date.now()};
    persist();renderToday();toast("GPSを記録しました");
  },()=>toast("GPSを取得できませんでした"),{enableHighAccuracy:true,timeout:10000});
};
$("quickShareButton").onclick=()=>{generateReport();shareReport();};
$("addJobButton").onclick=()=>{state.todayJobs.push(emptyJob());persist();renderJobs();};
document.querySelectorAll("[data-quick-product]").forEach(button=>button.onclick=()=>{
  ensureJob();const job=state.todayJobs[state.todayJobs.length-1],key=button.dataset.quickProduct;
  job[key]=Number(job[key]||0)+1;persist();renderJobs();renderToday();
});
$("generateReportButton").onclick=generateReport;
$("copyReportButton").onclick=async()=>{await navigator.clipboard.writeText($("reportOutput").value||reportFor(todayRecord(),state.todayJobs));toast("日報をコピーしました");};
$("shareReportButton").onclick=shareReport;
$("saveReportButton").onclick=()=>{if(storeCurrentReport()) toast("日報を保存しました");};
$("printReportButton").onclick=()=>window.print();
$("calendarButton").onclick=createCalendarFile;
$("sheetButton").onclick=sendSheet;
$("filterFrom").oninput=$("filterTo").oninput=$("filterQuery").oninput=renderHistory;
$("saveEditButton").onclick=saveEdit;
$("csvButton").onclick=exportCsv;
$("backupButton").onclick=backup;
$("restoreInput").onchange=()=>{const f=$("restoreInput").files?.[0];if(f)restore(f);};
$("addShiftButton").onclick=()=>{
  $("shiftDate").value=dateKey(new Date());$("shiftStart").value="09:00";$("shiftEnd").value="18:00";$("shiftPlace").value="";$("shiftNote").value="";
  $("shiftModal").classList.remove("hidden");
};
$("saveShiftButton").onclick=()=>{
  if(!$("shiftDate").value||!$("shiftStart").value||!$("shiftEnd").value){toast("日付と時間を入力してください");return;}
  state.shifts.push({id:uid(),workplaceId:$("shiftWorkplace").value,date:$("shiftDate").value,start:$("shiftStart").value,end:$("shiftEnd").value,place:$("shiftPlace").value.trim(),note:$("shiftNote").value.trim()});
  persist();$("shiftModal").classList.add("hidden");renderShifts();renderNextShift();toast("シフトを登録しました");
};
$("monthPicker").oninput=renderAnalytics;
$("monthWorkplace").onchange=renderAnalytics;
$("saveSettingsButton").onclick=saveSettings;
$("lockNowButton").onclick=lock;
$("unlockButton").onclick=unlock;
$("unlockPin").onkeydown=e=>{if(e.key==="Enter")unlock();};
$("clearDataButton").onclick=()=>{
  if(confirm("勤怠・日報・シフトを含む全データを削除しますか？")){
    localStorage.removeItem(STATE_KEY);location.reload();
  }
};

applyTheme();fillSettings();ensureJob();persist();renderAll();generateReport();setInterval(updateClock,1000);
if(settings.pin) lock();
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
})();