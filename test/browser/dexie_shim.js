/* Minimal in-memory Dexie shim for headless testing only */
(function(){
  function clone(v){ return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  class Collection {
    constructor(table, rows){ this.table=table; this.rows=rows; this._rev=false; this._limit=null; }
    _copy(rows){ const c=new Collection(this.table, rows); c._rev=this._rev; c._limit=this._limit; return c; }
    filter(fn){ return this._copy(this.rows.filter(fn)); }
    and(fn){ return this.filter(fn); }
    reverse(){ const c=this._copy(this.rows.slice().reverse()); return c; }
    limit(n){ return this._copy(this.rows.slice(0,n)); }
    offset(n){ return this._copy(this.rows.slice(n)); }
    async toArray(){ return this.rows.map(clone); }
    async count(){ return this.rows.length; }
    async first(){ return this.rows.length ? clone(this.rows[0]) : undefined; }
    async last(){ return this.rows.length ? clone(this.rows[this.rows.length-1]) : undefined; }
    async each(fn){ this.rows.forEach(r=>fn(clone(r))); }
    async keys(){ const pk=this.table.pk; return this.rows.map(r=>r[pk]); }
    async primaryKeys(){ return this.keys(); }
    async sortBy(key){ return this.rows.slice().sort((a,b)=> a[key]>b[key]?1:a[key]<b[key]?-1:0).map(clone); }
    async delete(){ const pk=this.table.pk; this.rows.forEach(r=>this.table.map.delete(r[pk])); return this.rows.length; }
    async modify(changes){ this.rows.forEach(r=>{ if(typeof changes==='function') changes(r); else Object.assign(r,changes); }); return this.rows.length; }
  }
  class WhereClause {
    constructor(table, idx){ this.table=table; this.idx=idx; }
    _rows(){ return Array.from(this.table.map.values()); }
    equals(v){ return new Collection(this.table, this._rows().filter(r=> r[this.idx]===v || (Array.isArray(r[this.idx]) && r[this.idx].includes(v)))); }
    anyOf(...vals){ vals=vals.flat(); return new Collection(this.table, this._rows().filter(r=>vals.includes(r[this.idx]))); }
    aboveOrEqual(v){ return new Collection(this.table, this._rows().filter(r=>r[this.idx]!==undefined && r[this.idx]>=v)); }
    above(v){ return new Collection(this.table, this._rows().filter(r=>r[this.idx]>v)); }
    belowOrEqual(v){ return new Collection(this.table, this._rows().filter(r=>r[this.idx]<=v)); }
    below(v){ return new Collection(this.table, this._rows().filter(r=>r[this.idx]<v)); }
    between(a,b,il=true,iu=false){ return new Collection(this.table, this._rows().filter(r=>{const x=r[this.idx]; return x!==undefined && (il?x>=a:x>a) && (iu?x<=b:x<b);})); }
    startsWith(p){ return new Collection(this.table, this._rows().filter(r=>String(r[this.idx]||'').startsWith(p))); }
  }
  class Table {
    constructor(name, spec){ this.name=name; this.map=new Map(); this.auto=false; this.seq=0; this.setSpec(spec); }
    setSpec(spec){ const first=spec.split(',')[0].trim(); if(first.startsWith('++')){ this.auto=true; this.pk=first.slice(2);} else this.pk=first; }
    _all(){ return Array.from(this.map.values()); }
    async get(k){ if(typeof k==='object' && k!==null){ const r=this._all().find(x=>Object.keys(k).every(kk=>x[kk]===k[kk])); return clone(r);} const r=this.map.get(k); return clone(r); }
    async add(o){ o=clone(o); if(this.auto && (o[this.pk]===undefined)){ o[this.pk]=++this.seq; } const k=o[this.pk]; if(k===undefined) throw new Error('no key'); if(this.map.has(k)) throw new Error('ConstraintError: key exists '+this.name+' '+k); if(typeof k==='number') this.seq=Math.max(this.seq,k); this.map.set(k,o); return k; }
    async put(o){ o=clone(o); if(this.auto && o[this.pk]===undefined) o[this.pk]=++this.seq; const k=o[this.pk]; if(typeof k==='number') this.seq=Math.max(this.seq,k); this.map.set(k,o); return k; }
    async bulkAdd(a){ for(const o of a) await this.add(o); }
    async bulkPut(a){ for(const o of a) await this.put(o); }
    async bulkGet(ks){ return ks.map(k=>clone(this.map.get(k))); }
    async bulkDelete(ks){ ks.forEach(k=>this.map.delete(k)); }
    async update(k,ch){ const r=this.map.get(k); if(!r) return 0; Object.assign(r,clone(ch)); return 1; }
    async delete(k){ this.map.delete(k); }
    async clear(){ this.map.clear(); }
    async count(){ return this.map.size; }
    async toArray(){ return this._all().map(clone); }
    filter(fn){ return new Collection(this, this._all().filter(fn)); }
    where(idx){ if(typeof idx==='object'){ const ks=Object.keys(idx); return { equals:()=>new Collection(this,this._all().filter(r=>ks.every(k=>r[k]===idx[k]))), first: async()=>{ const r=this._all().find(r=>ks.every(k=>r[k]===idx[k])); return clone(r);} , toArray: async()=>this._all().filter(r=>ks.every(k=>r[k]===idx[k])).map(clone) }; } return new WhereClause(this, idx); }
    orderBy(key){ return new Collection(this, this._all().sort((a,b)=> a[key]>b[key]?1:a[key]<b[key]?-1:0)); }
    reverse(){ return new Collection(this, this._all().reverse()); }
    limit(n){ return new Collection(this, this._all().slice(0,n)); }
    toCollection(){ return new Collection(this, this._all()); }
    async first(){ return clone(this._all()[0]); }
    async keys(){ return this._all().map(r=>r[this.pk]); }
  }
  class Version { constructor(db){ this.db=db; } stores(s){ for(const [n,spec] of Object.entries(s)){ if(!this.db._t[n]){ this.db._t[n]=new Table(n,spec); this.db[n]=this.db._t[n]; } else this.db._t[n].setSpec(spec); } return this; } upgrade(){ return this; } }
  class Dexie {
    constructor(name){ this.name=name; this._t={}; }
    version(){ return new Version(this); }
    table(n){ return this._t[n]; }
    get tables(){ return Object.values(this._t); }
    async open(){ return this; }
    close(){}
    isOpen(){ return true; }
    on(){ return { subscribe(){}, unsubscribe(){} }; }
    async transaction(...args){ const fn=args[args.length-1]; return fn(); }
    async delete(){ Object.values(this._t).forEach(t=>t.map.clear()); }
  }
  Dexie.Promise = Promise;
  window.Dexie = Dexie;
})();
