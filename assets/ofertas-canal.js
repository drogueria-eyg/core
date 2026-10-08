/* ===================== ¿PARA QUIÉN ES ESTA OFERTA? (Farmacias / Instituciones) =====================
   Decisión de Dirección (8/10/2026): el que define si un CLIENTE es farmacia o institución es su
   RUBRO (campo Studio de la ficha). Este módulo hace lo mismo para un PRODUCTO: mira a qué rubro
   se le vendió en los últimos 12 meses y de ahí sale el destino sugerido de la oferta.

   La regla, medida sobre el catálogo con stock el 8/10/2026 (768 productos):
   · se suma lo vendido NETO (no unidades: una ampolla y una caja no pesan igual) a clientes
     FARMACIAS por un lado e INSTITUCIONES + SAMCO por el otro. Los demás rubros (distribuidoras,
     veterinarias, droguerías, personal) no votan: no son ninguno de los dos públicos;
   · 70% o más a instituciones → Instituciones; 70% o más a farmacias → Farmacias; si no, Ambos.
     Con ese corte quedaron 323 farmacia · 306 institución · 62 ambos · 77 sin ventas;
   · SIN VENTAS en el año → la familia del producto, que separa casi igual de limpio:
     éticos 86% farmacia, descartables 88% institución. Hospitalarios (61/39) y farmacopea no
     alcanzan el corte → Ambos.

   Uso:  const m = await EYGCanal.dePlantillas([tmplIds])   → {tmplId: info}
         const m = await EYGCanal.deVariantes([varIds])     → {varId:  info}
         const i = await EYGCanal.deCategoria(catId)        → info
   info = {canal:'farm'|'inst'|'ambos', instPct (0-1 o null), farm, inst (pesos), por:'ventas'|'familia'}
   Fail-open: si Odoo no responde devuelve {} y la pantalla sigue sin el dato. */
(function(){
  const UMBRAL = 0.70, DIAS = 365;
  const RF = (window.EYG && EYG.RUBRO_FIELD) || "x_studio_selection_field_6ui_1j42g6fu9";
  const seg = r => { r = (window.EYG && EYG.rubroNorm) ? EYG.rubroNorm(r) : r;
    return r==="FARMACIAS" ? "f" : (r==="INSTITUCIONES" || r==="SAMCO") ? "i" : null; };
  // familia = 2º nivel de la categoría ("ALL / ETICOS / …")
  const FAMILIA = { "ETICOS":"farm", "PERFUMERIA":"farm", "DESCARTABLES":"inst", "EQUIPOS MEDICOS":"inst", "ORTOPEDIA":"inst" };
  const famDe = catName => { const p=(catName||"").split(" / "); return FAMILIA[(p[1]||"").trim().toUpperCase()] || "ambos"; };

  const META = {
    farm:  { t:"Farmacias",                 ico:"💊", corto:"farmacias" },
    inst:  { t:"Instituciones",             ico:"🏥", corto:"instituciones" },
    ambos: { t:"Farmacias e instituciones", ico:"🔀", corto:"ambos" }
  };

  function clasificar(f, i, catName){
    const t=f+i;
    if(t>0){ const ip=i/t; return { canal: ip>=UMBRAL?"inst":(ip<=1-UMBRAL?"farm":"ambos"), instPct:ip, farm:f, inst:i, por:"ventas" }; }
    return { canal: famDe(catName), instPct:null, farm:0, inst:0, por:"familia" };
  }

  const _rub = {};   // partner → 'f' | 'i' | null (cache de la página)
  async function rubros(pids){
    const falta=pids.filter(p=>!(p in _rub));
    if(!falta.length) return;
    const ps=[]; for(let k=0;k<falta.length;k+=500) ps.push(...await EYG.rpc("res.partner","read",[falta.slice(k,k+500),[RF,"commercial_partner_id"]]));
    // una dirección de entrega sin rubro hereda el del cliente fiscal
    const padres=[...new Set(ps.filter(p=>!p[RF] && p.commercial_partner_id && p.commercial_partner_id[0]!==p.id).map(p=>p.commercial_partner_id[0]))];
    const rp={}; if(padres.length) (await EYG.rpc("res.partner","read",[padres,[RF]])).forEach(p=>rp[p.id]=p[RF]);
    ps.forEach(p=>{ _rub[p.id]=seg(p[RF] || (p.commercial_partner_id && rp[p.commercial_partner_id[0]]) || ""); });
  }
  function desde(){ const d=new Date(Date.now()-DIAS*864e5); return d.toISOString().slice(0,10); }

  // ventas netas por variante → {varId:{f,i}}
  async function ventas(varIds){
    if(!varIds.length) return {};
    const g=await EYG.rpc("sale.order.line","read_group",
      [[["product_id","in",varIds],["state","in",["sale","done"]],["order_id.date_order",">=",desde()]],["price_subtotal:sum"],["product_id","order_partner_id"]],{lazy:false});
    await rubros([...new Set(g.map(x=>x.order_partner_id&&x.order_partner_id[0]).filter(Boolean))]);
    const out={};
    g.forEach(x=>{ if(!x.product_id||!x.order_partner_id) return; const s=_rub[x.order_partner_id[0]]; if(!s) return;
      const v=out[x.product_id[0]]||(out[x.product_id[0]]={f:0,i:0}); v[s]+=x.price_subtotal||0; });
    return out;
  }

  async function deVariantes(varIds){
    try{
      varIds=[...new Set((varIds||[]).filter(Boolean))]; if(!varIds.length) return {};
      const [vs, pr]=await Promise.all([ventas(varIds), EYG.rpc("product.product","read",[varIds,["categ_id"]])]);
      const out={}; pr.forEach(p=>{ const v=vs[p.id]||{f:0,i:0}; out[p.id]=clasificar(v.f,v.i,p.categ_id&&p.categ_id[1]); });
      return out;
    }catch(e){ return {}; }
  }
  // el motor guarda PLANTILLAS (target de eyg.sync_ofertas): se suman sus variantes
  async function dePlantillas(tmplIds){
    try{
      tmplIds=[...new Set((tmplIds||[]).filter(Boolean))]; if(!tmplIds.length) return {};
      const vs=await EYG.rpc("product.product","search_read",[[["product_tmpl_id","in",tmplIds]]],{fields:["id","product_tmpl_id","categ_id"],limit:0});
      const vt=await ventas(vs.map(v=>v.id));
      const acc={}; vs.forEach(v=>{ const t=v.product_tmpl_id[0]; const a=acc[t]||(acc[t]={f:0,i:0,cat:v.categ_id&&v.categ_id[1]}); const x=vt[v.id]; if(x){ a.f+=x.f; a.i+=x.i; } });
      const out={}; Object.keys(acc).forEach(t=>{ const a=acc[t]; out[t]=clasificar(a.f,a.i,a.cat); });
      return out;
    }catch(e){ return {}; }
  }
  // oferta de CATEGORÍA: lo vendido de toda la categoría (con sus subcategorías)
  async function deCategoria(catId){
    try{
      const [g, c]=await Promise.all([
        EYG.rpc("sale.order.line","read_group",[[["product_id.categ_id","child_of",catId],["state","in",["sale","done"]],["order_id.date_order",">=",desde()]],["price_subtotal:sum"],["order_partner_id"]],{lazy:false}),
        EYG.rpc("product.category","read",[[catId],["complete_name"]])]);
      await rubros([...new Set(g.map(x=>x.order_partner_id&&x.order_partner_id[0]).filter(Boolean))]);
      let f=0,i=0; g.forEach(x=>{ const s=x.order_partner_id&&_rub[x.order_partner_id[0]]; if(s==="f") f+=x.price_subtotal||0; else if(s==="i") i+=x.price_subtotal||0; });
      return clasificar(f,i,c&&c[0]&&c[0].complete_name);
    }catch(e){ return null; }
  }

  // el destino de una oferta: el que se eligió a mano, si no el sugerido
  const destino = (o, sugerido) => (o && o.destino && META[o.destino]) ? o.destino : (sugerido || null);
  // por qué se sugiere, en criollo
  function motivo(info){
    if(!info) return "";
    if(info.por==="familia") return "no se vendió en el último año: se sugiere por la familia del producto";
    const pi=Math.round(info.instPct*100);
    return pi>=50 ? `el ${pi}% de lo vendido en el último año fue a instituciones y SAMCO`
                  : `el ${100-pi}% de lo vendido en el último año fue a farmacias`;
  }
  function chip(canal, manual){
    const m=META[canal]; if(!m) return "";
    return `<span class="chip ${canal==='inst'?'c-oro':canal==='farm'?'c-teal':'c-gris'}" title="${manual?'Destino elegido a mano':'Destino sugerido por las ventas del producto'}">${m.ico} ${m.corto}${manual?'':' · auto'}</span>`;
  }

  window.EYGCanal = { UMBRAL, META, clasificar, deVariantes, dePlantillas, deCategoria, destino, motivo, chip };
})();
