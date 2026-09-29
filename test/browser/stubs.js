window.__modalLog = [];
window.__swalLog = [];
(function(){
  const shown = new Set();
  class Modal {
    constructor(el){ this._el=el; }
    static getOrCreateInstance(el){ if(!el.__m) el.__m=new Modal(el); return el.__m; }
    static getInstance(el){ return el.__m || null; }
    show(){ window.__modalLog.push('show:'+this._el.id); this._el.classList.add('show'); this._el.style.display='block'; shown.add(this._el.id); }
    hide(){ window.__modalLog.push('hide:'+this._el.id); this._el.classList.remove('show'); this._el.style.display='none'; shown.delete(this._el.id); }
    dispose(){}
  }
  window.bootstrap = { Modal, Tab: class { static getOrCreateInstance(){ return {show(){}}; } }, Toast: class { static getOrCreateInstance(){ return {show(){}}; } }, Tooltip: class{ constructor(){} }, Dropdown: class { static getOrCreateInstance(){ return {show(){},hide(){}}; } } };
  window.__openModals = () => Array.from(shown);
  const swal = (o)=>{ window.__swalLog.push(typeof o==='object'?(o.title||o.text||JSON.stringify(o)).toString().slice(0,120):String(o)); return Promise.resolve({isConfirmed:false,isDismissed:true,value:undefined}); };
  window.Swal = { fire: (...a)=> swal(typeof a[0]==='object'?a[0]:{title:a[0],text:a[1]}), close(){}, showLoading(){}, hideLoading(){}, isVisible(){return false;}, mixin(){ return window.Swal; }, showValidationMessage(){}, getPopup(){return null;} };
  const chain = { select(){return chain;}, eq(){return chain;}, single(){return Promise.resolve({data:null,error:{message:'stub'}});}, insert(){return chain;}, upsert(){return chain;}, update(){return chain;}, delete(){return chain;}, in(){return chain;}, order(){return chain;}, limit(){return chain;}, maybeSingle(){return Promise.resolve({data:null,error:null});}, then(res){ return Promise.resolve({data:[],error:null}).then(res); } };
  window.supabase = { createClient(){ return { from(){return chain;}, rpc(){return Promise.resolve({data:null,error:null});}, auth:{ getSession(){return Promise.resolve({data:{session:null}});}, signInWithPassword(){return Promise.resolve({data:null,error:{message:'stub'}});}, signOut(){return Promise.resolve({});}, onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};} }, channel(){ return {on(){return this;}, subscribe(){return this;}}; }, removeChannel(){} }; } };
  window.jspdf = { jsPDF: function(){ return { text(){}, save(){}, addPage(){}, setFont(){}, setFontSize(){}, addFileToVFS(){}, addFont(){} }; } };
})();
