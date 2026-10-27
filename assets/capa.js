/* =====================================================================
   EYGCapa — LA CAPA TEMPORAL DEL MOTOR, UNA SOLA VEZ (27/10/2026)
   Lo comparten Oportunidades y Ofertas (donde se crea y edita todo) y el Motor de precios (que la
   muestra en solo lectura). Antes esta lógica vivía sólo en comercial/config-precios.html.

   QUÉ ES LA CAPA: líneas que PISAN al motor (acción 1213), en tres parámetros, uno por lista:
     tier 1 Farmacias (lista 3)          eyg.precios_fijos_flat
     tier 2 SAMCOs y clínicas (lista 16) eyg.t2_precios_fijos_flat
     tier 3 Instituciones (lista 5)      eyg.t3_precios_fijos_flat
   Formato del motor (9 campos): clave~precio~descmax~tramos~tope~perforar~hasta~pausado~nombre
     clave   = id de PLANTILLA, o 'M<id>' (Marca) / 'C<id>' (categoría-laboratorio de éticos) en tier 1
     precio  = tier 1: precio único FINAL CON IVA (el motor publica neto = precio/(1+IVA))
               tiers 2/3: precio NETO (el motor lo publica tal cual)
     descmax = FRACCIÓN (0.40) · descuento máximo de la escalera (éticos: SOBRE EL PVP; resto: sobre la base)
     tramos  = 1 precio único · N escalera de N tramos · vacío = los del motor
     tope    = cajas del último tramo (vacío = franjas del motor) · perforar = '1' autorizado bajo el piso
   Las líneas "[OFERTA <id>] …" de los tiers 2/3 son COPIAS automáticas de una oferta de Oportunidades
   (sincronizarEspejoInst): se conservan tal cual y no se editan desde acá.
   Formato viejo de tiers 2/3 (5 campos: tmpl~precio~hasta~pausado~nombre): se lee y se guarda en 9.

   ESCRIBIR: siempre se relee el parámetro justo antes (lo pueden haber cambiado otra pantalla, el
   espejo de instituciones o el control de placas) y se aplica sólo el cambio pedido.
   ===================================================================== */
(function(){
  const KEY={1:"eyg.precios_fijos_flat",2:"eyg.t2_precios_fijos_flat",3:"eyg.t3_precios_fijos_flat"};
  const LISTA={1:3,2:16,3:5};
  const TIER_NOM={1:"Farmacias",2:"SAMCOs y clínicas",3:"Instituciones"};
  const ESPEJO="[OFERTA ";
  const TOL_COSTO=0.5, TOL_PISO=0.995;   // unos centavos de redondeo no son perforar
  const rpc=(...a)=>EYG.rpc(...a);
  const LANG={context:{lang:"es_AR"}};
  const limpio=s=>String(s||"").replace(/~/g,"-").replace(/\r?\n/g," ");

  /* ---------- líneas ---------- */
  function parse(l, tier){
    const raw=String(l||"").trim(); if(!raw) return null;
    let f=raw.split("~");
    if(tier!==1 && f.length<9) f=[f[0],f[1]||"0","","","","0",(f[2]||"").trim(),f[3]==="1"?"1":"0",f.slice(4).join("-")];
    const k=(f[0]||"").trim().toUpperCase();
    const esLab=tier===1 && (k[0]==="M"||k[0]==="C") && !isNaN(parseInt(k.slice(1)));
    const nombre=f.slice(8).join("~");
    const e={ tier, clave:esLab?k:String(parseInt(k)||""), tmpl:esLab?0:(parseInt(k)||0), lab:esLab?k[0]:"", labId:esLab?parseInt(k.slice(1)):0,
      precio:parseFloat(f[1])||0, descmax:(parseFloat(f[2])||0)*100, tramos:parseInt(f[3])||0, tope:parseInt(f[4])||0,
      perforar:f[5]==="1", hasta:(f[6]||"").trim(), pausado:f[7]==="1", nombre:nombre||("#"+k), espejo:nombre.startsWith(ESPEJO) };
    if(!(e.tmpl||e.lab)) return null;
    // la línea tal cual vino: si nadie la cambió se vuelve a escribir IDÉNTICA (ni un decimal distinto)
    Object.defineProperty(e,"_raw",{value:raw,enumerable:false}); Object.defineProperty(e,"_sig",{value:firma(e),enumerable:false});
    return e;
  }
  const firma=e=>[e.lab,e.labId,e.tmpl,e.precio,e.descmax,e.tramos,e.tope,e.perforar,e.hasta,e.pausado,e.nombre].join("|");
  function linea(e){
    if(e._raw && e._sig===firma(e)) return e._raw;
    const clave=e.lab?(e.lab+e.labId):e.tmpl;
    if(e.tier!==1) return [clave, (+e.precio||0), "", "", "", e.perforar?"1":"0", e.hasta||"", e.pausado?"1":"0", limpio(e.nombre)].join("~");
    return [clave, (+e.precio||0), (e.descmax?((+e.descmax)/100):0), (e.tramos||""), (e.tope||""), e.perforar?"1":"0", e.hasta||"", e.pausado?"1":"0", limpio(e.nombre)].join("~");
  }
  const vigente=(e,hoy)=>!e.pausado && !(e.hasta && e.hasta<hoy);
  const claveDe=e=>e.lab?(e.lab+e.labId):String(e.tmpl);

  async function leer(tier){
    const raw=String(await rpc("ir.config_parameter","get_param",[KEY[tier]])||"");
    return { raw, lineas:raw.split("\n").map(l=>parse(l,tier)).filter(Boolean) };
  }
  async function leerTodo(){ const [a,b,c]=await Promise.all([leer(1),leer(2),leer(3)]); return {1:a,2:b,3:c}; }
  /* Escribe un tier aplicando sólo `cambio(lineas)` sobre lo que hay AHORA en Odoo.
     Devuelve el texto anterior, para poder deshacer. Las copias "[OFERTA …]" no se tocan. */
  async function escribir(tier, cambio){
    const {raw, lineas}=await leer(tier);
    const propias=lineas.filter(e=>!e.espejo), espejo=lineas.filter(e=>e.espejo);
    const nuevas=cambio(propias.slice())||propias;
    const txt=nuevas.concat(espejo).map(linea).join("\n");
    if(txt!==raw) await rpc("ir.config_parameter","set_param",[KEY[tier], txt]);
    return raw;
  }
  async function restaurar(tier, raw){ await rpc("ir.config_parameter","set_param",[KEY[tier], raw]); }
  // poner / sacar la línea de una clave en un tier
  const poner=(tier, ent)=>escribir(tier, L=>{ const k=claveDe(ent); const i=L.findIndex(x=>claveDe(x)===k); const e=Object.assign({},ent,{tier}); if(i>=0) L[i]=e; else L.unshift(e); return L; });
  const sacar=(tier, clave)=>escribir(tier, L=>L.filter(x=>claveDe(x)!==String(clave)));

  /* ---------- reglas del motor (para simular el último escalón y el piso) ---------- */
  let R=null;   // {byId, CFG, ESCALA, tasas}
  async function cargarReglas(){
    if(R) return R;
    const [cats,cfg,esc,tasas]=await Promise.all([
      rpc("product.category","search_read",[[["id","child_of",1]]],{fields:["id","parent_id","complete_name"],limit:5000,context:{lang:"es_AR"}}),
      rpc("ir.config_parameter","get_param",["eyg.sync_precios_config"]),
      rpc("ir.config_parameter","get_param",["eyg.eticos_escala"]),
      EYG.tasasVenta() ]);
    const byId={}; (cats||[]).forEach(c=>{ const full=String(c.complete_name||"").replace(/^ALL \/ /,""); byId[c.id]={id:c.id, full, top:full.split(" / ")[0], pid:c.parent_id?c.parent_id[0]:null}; });
    let CFG={reglas:{}}; try{ CFG=JSON.parse(cfg||"{}")||{reglas:{}}; }catch(e){} if(!CFG.reglas) CFG.reglas={};
    let ESCALA={}; try{ ESCALA=JSON.parse(esc||"{}")||{}; }catch(e){}
    R={byId, CFG, ESCALA, tasas:tasas||{}};
    return R;
  }
  function reglaMotor(catId){
    if(!R) return null;
    const c=R.byId[catId];
    if(c && c.top==="ETICOS"){
      let r=R.CFG.reglas[catId]||null;
      if(!r){ const e=R.ESCALA[catId]; if(e && R.CFG.escala && R.CFG.escala[e]) r=R.CFG.escala[e]; }
      return (r&&r.genera)?Object.assign({},r,{base:"pvp"}):null;
    }
    let cur=catId, g=0;
    while(cur && g++<20){ const r=R.CFG.reglas[cur]; if(r) return r.genera?Object.assign({},r,{base:(r.base||"costo")}):null; cur=R.byId[cur]?R.byId[cur].pid:null; }
    return null;
  }
  // costo con el que mide el motor: el neto + el IVA de compra cuando el producto se vende exento
  const costoEf=p=>(p.costo||0)*(1+(EYG.vendeExento(p.taxesId,(R&&R.tasas)||{})?(p.ivaCompra||0):0));
  /* el ÚLTIMO escalón, con la cuenta del motor (perforar=true: sin clampear al piso, lo que se PIDE) */
  function ultimoEscalon(p, dmFrac, perforar){
    const r=reglaMotor(p.catId);
    if(!r) return {motivo:"sin regla de precio"};
    const costo=costoEf(p), pvp=p.pvp||0;
    if(r.base==="pvp" && !(pvp>0)) return {motivo:"sin PVP"};
    if(r.base!=="pvp" && !(costo>0)) return {motivo:"sin costo"};
    const piso=(costo>0 && (r.piso||0)<1)?costo/(1-(r.piso||0)):0;
    const base=(r.base==="pvp")?pvp*(1-(r.recargo||0)):costo*(1+(r.recargo||0));
    let precio=dmFrac>0 ? ((r.base==="pvp")?pvp*(1-dmFrac):base*(1-dmFrac)) : (piso>0?piso:base);
    if(!perforar && piso>0 && precio<piso) precio=piso;
    return {precio, costo, piso, base, margen:(precio>0?(precio-costo)/precio*100:null)};
  }
  /* ¿qué queda bajo el costo o bajo el piso? (sin clampear: lo que la capa realmente pide) */
  function chequear(ent, filas){
    const out={bajoCosto:[], bajoPiso:[], sinDato:[], total:0};
    (filas||[]).forEach(p=>{
      if(p.propia) return;
      out.total++;
      const costo=costoEf(p), r=reglaMotor(p.catId);
      let precio=null, motivo="";
      if(ent.tier!==1){ precio=+ent.precio||0; if(!(precio>0)) motivo="sin precio"; }                 // listas 2/3: neto
      else if(ent.tramos===1){ precio=(ent.precio||0)/(1+((p.ivaVenta||0)/100)); if(!(precio>0)) motivo="sin precio"; }   // lista 1: con IVA
      else { const e=ultimoEscalon(p,(ent.descmax||0)/100,true); if(e.motivo) motivo=e.motivo; else precio=e.precio; }
      if(!(costo>0)) motivo=motivo||"sin costo";
      if(motivo||!(precio>0)){ out.sinDato.push(Object.assign({},p,{motivo:motivo||"sin precio"})); return; }
      const piso=(r&&(r.piso||0)<1)?costo/(1-(r.piso||0)):0;
      const it=Object.assign({},p,{precio, costoEf:costo, piso, margen:(precio-costo)/precio*100});
      if(precio<costo-TOL_COSTO) out.bajoCosto.push(it);
      else if(ent.tier===1 && piso>0 && precio<piso*TOL_PISO) out.bajoPiso.push(it);
    });
    return out;
  }

  /* ---------- productos y laboratorios ---------- */
  async function infoProducto(tmpl){
    const [vs,tp,its]=await Promise.all([
      rpc("product.product","search_read",[[["product_tmpl_id","=",tmpl]],["x_costo_motor","standard_price","x_iva_compra","taxes_id","categ_id","qty_available","default_code","name"]],{limit:1,context:{lang:"es_AR"}}),
      rpc("product.template","read",[[tmpl],["taxes_id","list_price","name","categ_id"]],LANG),
      rpc("product.pricelist.item","search_read",[[["product_tmpl_id","=",tmpl],["pricelist_id","=",3]],["min_quantity","fixed_price"]],{limit:20}) ]);
    const v=vs[0]||{}, t=tp[0]||{};
    let iva=0; const tx=t.taxes_id||[];
    if(tx.length){ const tr=await rpc("account.tax","read",[tx,["amount","amount_type"]]); tr.forEach(x=>{ if(x.amount_type==="percent") iva+=x.amount; }); }
    const tramos=(its||[]).map(i=>({q:Math.round(i.min_quantity||1)||1,p:i.fixed_price})).sort((a,b)=>a.q-b.q);
    const cat=(t.categ_id&&t.categ_id[1])||"";
    return { tmpl, nombre:t.name||v.name||("#"+tmpl), sku:v.default_code||"", variante:v.id||0, catId:(v.categ_id?v.categ_id[0]:0), categ:cat,
      costo:v.x_costo_motor||0, ivaCompra:v.x_iva_compra||0, taxesId:v.taxes_id||[], ivaVenta:iva,
      pvp:/[EÉ]TICO/i.test(cat)?(t.list_price||0):0, stock:v.qty_available||0, tramos, base:tramos.length?tramos[0].p:0 };
  }
  /* un solo buscador: laboratorios (Marca 'M' y categoría de éticos 'C') y productos */
  async function buscar(q){
    q=String(q||"").trim(); if(q.length<2) return {labs:[], prods:[]};
    await cargarReglas();
    const [marcas,cats,prods]=await Promise.all([
      rpc("x_marcas","search_read",[[["x_name","ilike",q]],["id","x_name"]],{limit:5}).catch(()=>[]),
      rpc("product.category","search_read",[[["id","child_of",12],["name","ilike",q]],["id","complete_name"]],{limit:5,context:{lang:"es_AR"}}).catch(()=>[]),
      rpc("product.template","search_read",[["|",["name","ilike",q],["default_code","ilike",q]],["id","name","default_code"]],{limit:8,context:{lang:"es_AR"}}).catch(()=>[]) ]);
    const labs=[].concat(
      (marcas||[]).map(m=>({lab:"M", labId:m.id, nombre:m.x_name, dom:[["x_costo_motor",">",0],["x_studio_many2one_field_6o_1if0l6ud2","=",m.id]], et:"Marca de la ficha"})),
      (cats||[]).map(c=>({lab:"C", labId:c.id, nombre:String(c.complete_name).replace("ALL / ",""), dom:[["x_costo_motor",">",0],["categ_id","child_of",c.id]], et:"categoría del laboratorio"})));
    const grp=await Promise.all(labs.map(i=>rpc("product.product","read_group",[i.dom,["id"],["categ_id"]],{lazy:true}).catch(()=>[])));
    labs.forEach((i,k)=>{ const g=grp[k]||[]; i.n=g.reduce((a,x)=>a+(x.categ_id_count||0),0);
      const F={}; g.forEach(x=>{ const c=(x.categ_id&&R.byId[x.categ_id[0]]); const t=c?c.top:"otras"; F[t]=(F[t]||0)+(x.categ_id_count||0); });
      i.fam=Object.keys(F).map(t=>[t,F[t]]).sort((a,b)=>b[1]-a[1]); delete i.dom; });
    return { labs:labs.filter(i=>i.n>0).sort((a,b)=>b.n-a.n), prods:(prods||[]).map(p=>({tmpl:p.id, nombre:p.name, sku:p.default_code||""})) };
  }
  /* los productos de un laboratorio (para simular cómo queda cada uno); los que tienen línea propia no se tocan */
  async function filasLab(lab, labId, propiasTmpl){
    const dom = lab==="M" ? [["x_costo_motor",">",0],["x_studio_many2one_field_6o_1if0l6ud2","=",labId]] : [["x_costo_motor",">",0],["categ_id","child_of",labId]];
    const rs=await rpc("product.product","search_read",[dom,["default_code","name","categ_id","product_tmpl_id","x_costo_motor","x_iva_compra","taxes_id","list_price","qty_available"]],{limit:800,context:{lang:"es_AR"}});
    const prop=propiasTmpl||new Set();
    return (rs||[]).map(r=>({ sku:r.default_code||"", nombre:r.name||"", catId:(r.categ_id?r.categ_id[0]:0), tmpl:(r.product_tmpl_id?r.product_tmpl_id[0]:0),
      propia:prop.has(r.product_tmpl_id&&r.product_tmpl_id[0]), costo:r.x_costo_motor||0, ivaCompra:r.x_iva_compra||0, taxesId:r.taxes_id||[],
      pvp:r.list_price||0, stock:r.qty_available||0 }));
  }

  /* ---------- lo que quedó publicado en Odoo (la verdad, después de guardar) ---------- */
  async function publicado(tmpl){
    const vs=await rpc("product.product","search",[[["product_tmpl_id","=",tmpl]]]);
    const [t1,t23]=await Promise.all([
      rpc("product.pricelist.item","search_read",[[["pricelist_id","=",3],["product_tmpl_id","=",tmpl]]],{fields:["min_quantity","fixed_price"],limit:50}),
      vs.length?rpc("product.pricelist.item","search_read",[[["pricelist_id","in",[16,5]],["product_id","in",vs]]],{fields:["pricelist_id","fixed_price"],limit:50}):[] ]);
    const out={3:(t1||[]).map(i=>({q:Math.round(i.min_quantity||1)||1,p:i.fixed_price})).sort((a,b)=>a.q-b.q), 16:null, 5:null};
    (t23||[]).forEach(i=>{ const l=i.pricelist_id[0]; if(out[l]==null||i.fixed_price<out[l]) out[l]=i.fixed_price; });
    return out;
  }
  /* el motor aplica la capa: un producto en segundos; un laboratorio, corrida completa (minutos) */
  async function recalcular(ent){
    if(ent && ent.tmpl){
      const t=await rpc("product.template","read",[[ent.tmpl],["product_variant_id"]],LANG);
      const vid=t&&t[0]&&t[0].product_variant_id&&t[0].product_variant_id[0];
      if(vid){ await rpc("ir.actions.server","run",[[1213]],{context:{lang:"es_AR",eyg_solo_producto:vid}}); return "listo"; }
    }
    await EYG.recalcularPreciosTodo(null,{esperar:false});
    return "corrida";
  }

  window.EYGCapa={ KEY, LISTA, TIER_NOM, ESPEJO, parse, linea, vigente, claveDe, leer, leerTodo, escribir, restaurar, poner, sacar,
    cargarReglas, reglaMotor, costoEf, ultimoEscalon, chequear, infoProducto, buscar, filasLab, publicado, recalcular };
})();
