/* ===== EyG Core · Inventario · detección de oportunidades por STOCK =====
   Fuente única compartida por stock.html (que ya tiene los datos cargados) y
   oportunidades.html (que las calcula en vivo). Detecta hasta 5 productos que
   conviene ofertar a clientes por vencimiento, sobrestock o sin venta. */
window.EYGOpo = (function(){
  const LISTA = 3;                                   // pricelist "LISTA 1 EyG"
  const DESC  = { vence:0.25, sobre:0.15, muerto:0.20 }; // descuento sugerido por motivo

  const cleanName = n => (n||"").replace(/@$/,"").trim();
  function familia(categ){
    if(!categ) return "Sin categoría";
    const p = categ[1].split("/").map(s=>s.trim()).filter(s=>s && s.toUpperCase()!=="ALL");
    return p[0] || "Sin categoría";
  }
  function mesesHasta(f, HOY){ if(!f) return null; const d=new Date(f.slice(0,10)); return (d-HOY)/(1000*3600*24*30.44); }

  /* De filas normalizadas → top 20 candidatos rankeados (sin precio todavía).
     opts: {ignora:[ids], enOferta:[ids]} */
  function rank(rows, opts){
    opts = opts||{}; const ig=new Set(opts.ignora||[]), of=new Set(opts.enOferta||[]);
    return rows.filter(r=> r.qty>0 && r.activo!==false && !r.xop && !r.xarch && !ig.has(r.id) && !of.has(r.id)).map(r=>{
      const cu = r.qty>0 ? r.val/r.qty : 0;
      const nearExp = (r.val6>0 && r.min!=null && r.meses>r.min) ? r.val6*4 : 0; // vence antes de venderse
      const over    = r.meses>12 ? r.val*Math.min(r.meses,48)/24 : 0;            // sobrestock (capital congelado)
      const dead    = r.ventaU===0 ? r.val*0.6 : 0;                              // sin ventas
      const score   = nearExp+over+dead;
      const motivo  = r.ventaU===0 ? "muerto" : (nearExp>0?"vence":(over>0?"sobre":null));
      return {...r, cu, score, motivo};
    }).filter(r=> r.motivo && r.score>0).sort((a,b)=>b.score-a.score).slice(0,20);
  }

  /* De candidatos rankeados + mapa de precio base por template → hasta 5 items finales. */
  function finalize(cands, baseByTmpl){
    baseByTmpl = baseByTmpl||{};
    return cands.map(r=>{
      const base = baseByTmpl[r.tmpl]!=null ? baseByTmpl[r.tmpl] : r.pvp;
      const costo = r.sp>0 ? r.sp : r.cu;   // costo más reciente (standard_price sincronizado), fallback valuación
      const piso = costo*1.05, desc = DESC[r.motivo];
      let sug = Math.round(base*(1-desc)); if(sug<piso) sug=Math.round(piso);
      const margenAbs = Math.round(sug - costo);                                   // $ por unidad con la oferta
      const margenPct = (sug>0 && costo>0) ? Math.round((sug-costo)/sug*100) : null; // % sobre venta neta (sin IVA)
      const motTxt = r.motivo==="vence" ? `Vence en ${r.min}m y al ritmo actual no llega a venderse`
        : r.motivo==="sobre" ? `Sobrestock: ${r.meses} meses de stock`
        : `Sin ventas en los últimos 12 meses`;
      return { id:r.id, tmpl:r.tmpl, sku:r.code, nombre:cleanName(r.name), cat:r.fam,
        stock:r.qty, meses:r.meses>900?null:r.meses, min:r.min, valor:Math.round(r.val),
        motivo:r.motivo, motivoTxt:motTxt, precio:Math.round(base), costoU:Math.round(costo),
        desc, sugPrecio:sug, margenAbs, margenPct };
    }).filter(r=> r.precio>r.costoU*1.05 && r.precio<r.costoU*4).slice(0,5); // margen real, sin precios mal cargados
  }

  /* Precio de venta base (escalera min_quantity más baja) de la lista, por template. */
  async function fetchBase(rpc, tmpls){
    const baseByTmpl = {}; if(!tmpls.length) return baseByTmpl;
    const pit = await rpc("product.pricelist.item","search_read",
      [[["pricelist_id","=",LISTA],["applied_on","=","1_product"],["product_tmpl_id","in",tmpls]]],
      {fields:["product_tmpl_id","min_quantity","fixed_price"], limit:20000});
    const tmp={}; for(const it of pit){ const t=it.product_tmpl_id[0]; if(!tmp[t]||it.min_quantity<tmp[t].q) tmp[t]={q:it.min_quantity,p:it.fixed_price}; }
    for(const t in tmp) baseByTmpl[t]=tmp[t].p;
    return baseByTmpl;
  }

  /* Conveniencia para stock.html: ya tiene las filas → rankea, trae precios y finaliza. */
  async function desdeData(rpc, rows, opts){
    const cands = rank(rows, opts);
    const base = await fetchBase(rpc, [...new Set(cands.map(r=>r.tmpl).filter(Boolean))]);
    return finalize(cands, base);
  }

  /* Detección completa (hace todas las consultas). Para oportunidades.html. */
  async function detectar(rpc, opts){
    const HOY=new Date(); HOY.setHours(0,0,0,0);
    const iso=d=>d.toISOString().slice(0,10);
    const ini12=new Date(HOY.getFullYear(),HOY.getMonth()-12,1);
    const [stock,ventas]=await Promise.all([
      rpc("stock.quant","read_group",[[["location_id.usage","=","internal"],["quantity",">",0]],["value:sum","quantity:sum"],["product_id"]],{lazy:false,limit:5000}),
      rpc("sale.order.line","read_group",[[["order_id.state","in",["sale","done"]],["order_id.date_order",">=",iso(ini12)]],["product_uom_qty:sum"],["product_id"]],{lazy:false,limit:9000}),
    ]);
    const V={}; for(const v of ventas){ if(v.product_id) V[v.product_id[0]]=v.product_uom_qty||0; }
    const ids=stock.filter(s=>s.product_id).map(s=>s.product_id[0]);
    const [meta,quantsLote]=await Promise.all([
      rpc("product.product","read",[ids,["categ_id","default_code","name","standard_price","list_price","product_tmpl_id","active","x_oportunidad","x_oportunidad_archivada"]]),
      rpc("stock.quant","search_read",[[["location_id.usage","=","internal"],["quantity",">",0],["lot_id","!=",false]],["product_id","lot_id","quantity","value"]],{limit:5000}),
    ]);
    const M={}; for(const m of meta) M[m.id]=m;
    const lotIds=[...new Set(quantsLote.filter(q=>q.lot_id).map(q=>q.lot_id[0]))];
    const lotes = lotIds.length ? await rpc("stock.lot","read",[lotIds,["expiration_date","name"]]) : [];
    const L={}; for(const l of lotes) L[l.id]=l;
    const vencP={};
    for(const q of quantsLote){ if(!q.product_id||!q.lot_id) continue; const pid=q.product_id[0], lot=L[q.lot_id[0]]||{};
      const mh=lot.expiration_date?mesesHasta(lot.expiration_date,HOY):null;
      const vp=vencP[pid]||(vencP[pid]={v6:0,min:9999}); if(mh!=null){ if(mh<vp.min)vp.min=mh; if(mh>=0&&mh<6)vp.v6+=q.value; } }
    const rows=stock.filter(s=>s.product_id).map(s=>{ const id=s.product_id[0], m=M[id]||{}, vp=vencP[id]||{};
      const val=s.value||0, qty=s.quantity||0, ventaU=Math.round(V[id]||0), meses=ventaU>0?qty/(ventaU/12):999;
      return {id, tmpl:m.product_tmpl_id?m.product_tmpl_id[0]:null, activo:m.active!==false, xop:!!m.x_oportunidad, xarch:!!m.x_oportunidad_archivada,
        code:m.default_code||"", name:s.product_id[1], fam:familia(m.categ_id),
        val, qty, ventaU, meses:meses>900?999:Math.round(meses*10)/10, pvp:m.list_price||0, sp:m.standard_price||0,
        min:(vp.min!==undefined&&vp.min<9999)?Math.round(vp.min*10)/10:null, val6:Math.round(vp.v6||0)}; });
    return await desdeData(rpc, rows, opts);
  }

  return { LISTA, DESC, rank, finalize, fetchBase, desdeData, detectar };
})();
