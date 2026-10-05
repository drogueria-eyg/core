/* ===== EyG Core · Inventario · detección de oportunidades por STOCK =====
   Detecta qué conviene LIQUIDAR. Es GROUP-AWARE: agrupa el mismo producto de
   distinta MARCA/DROGA (igual que stock.html Fases 1-2) y mide la rotación del
   GRUPO, para NO sugerir liquidar el stock activo de un producto que sí rota
   (ej. la jeringa EUROMIX cuyo grupo vende ~1M/año). Ordena por PLATA A
   RECUPERAR × URGENCIA. El tier "liquidar" sugiere precio casi al costo.
   NOTA: las funciones de agrupación son copia de inventario/stock.html; si se
   tocan allá, mantener sincronizadas (pendiente: extraer a un módulo común). */
window.EYGOpo = (function(){
  const LISTA = 3;                                   // pricelist "LISTA 1 EyG"
  const DESC  = { vence:0.25, sobre:0.15, muerto:0.20, clavado:0.22, discontinuada:0.20 };
  const MARGEN_LIQ = 0.05;                            // tier liquidar: precio = costo × (1+margen)
  const URG   = { vence:4, muerto:2.5, discontinuada:2.3, clavado:2.2, sobre:1 };

  const cleanName = n => (n||"").replace(/@$/,"").trim();
  function familia(categ){
    if(!categ) return "Sin categoría";
    const p = categ[1].split("/").map(s=>s.trim()).filter(s=>s && s.toUpperCase()!=="ALL");
    return p[0] || "Sin categoría";
  }
  function mesesHasta(f, HOY){ if(!f) return null; const d=new Date(f.slice(0,10)); return (d-HOY)/(1000*3600*24*30.44); }

  /* ---- agrupación por marca/droga (copia sincronizada de stock.html) ---- */
  const _stripN = s => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase();
  const _PACKW = "COMP|COMPR|AMP|CAPS|TIRAS?|UNIDADES?|UNID|BLISTERS?|SOBRES?|COMPRIMIDOS?";
  let BRANDS = new Set();
  function nucleoProd(name, categ){
    const perf=/PERFUMERIA/.test(categ||""); let s=_stripN(name);
    s=s.replace(/\[[^\]]*\]/g," ").replace(/\(.*?\)/g," ").replace(/PRECIO\s+X[^-]*/g," ").replace(/[^A-Z0-9%\/. ]+/g," ");
    s=s.replace(/(\d)\s*GRS?\b/g,"$1G").replace(/\bGRS?\b/g,"G");
    s=s.replace(/\bCC\b/g,"ML").replace(/S\s*\/\s*AGUJA/g," SA ").replace(/S\s*\/\s*A\b/g," SA ").replace(/C\s*\/\s*AGUJA/g," CA ");
    s=s.replace(/\bCOMPRIMIDOS?\b/g,"COMP").replace(/\bCOMP\b/g,"COMP").replace(/\bAMPOLLAS?\b/g,"AMP").replace(/\bCAPSULAS?\b/g,"CAPS").replace(/\bCAP\b/g,"CAPS").replace(/\bJARABE\b/g,"JBE").replace(/\bMGS?\b/g,"MG");
    s=s.replace(/(?:X\s*)?(\d+[.,]?\d*)\s*(KG|MCG|MG|ML|CM|MM|UI|G|L|%)\b/g,(m,a,u)=>" "+a.replace(",",".")+u+" ");
    s=" "+s.replace(/\s+/g," ").trim()+" ";
    for(const b of BRANDS){ if(b.length<3) continue; let pat=" "+b+" "; while(s.indexOf(pat)>=0) s=s.replace(pat," "); }
    if(!perf) s=s.replace(/\bX\s*\d+([.,]\d+)?\b/g," ");
    s=s.replace(new RegExp("\\b("+_PACKW+"|CAJA|CAJAS|BOLSA|BOLSAS|PACK|BLISTER|BLISTERS|SOBRE|SOBRES|ESTUCHE|DISPLAY|X|DE|EL|LA|POR|C|S|H)\\b","g")," ");
    s=s.replace(/\./g,"").replace(/[^A-Z0-9%]+/g," ").replace(/\s+/g," ").trim();
    return s.split(" ").filter(Boolean).sort().join(" ");
  }
  function concMed(name){ let s=_stripN(name).replace(/\[[^\]]*\]/g," ").replace(/\(.*?\)/g," ");
    s=s.replace(/(\d)\s*GRS?\b/g,"$1G").replace(/\bGRS?\b/g,"G").replace(/\bCC\b/g,"ML").replace(/(\d)\s*MGS?\b/g,"$1MG").replace(/(\d)\s*(?:UG|MCG|µG|ΜG)\b/g,"$1MCG");
    const out=[]; const re=/([X×]?)\s*(\d+[.,]?\d*)\s*(MCG|MG|ML|UI|KG|G|%)(?![A-Z0-9])/g; let m;
    while((m=re.exec(s))){ if(m[1]==="X"||m[1]==="×") continue; let v=parseFloat(m[2].replace(",",".")), u=m[3];
      if(u==="G"){ v=v*1000; u="MG"; } else if(u==="KG"){ v=v*1e6; u="MG"; } out.push(v+u); }
    const activos=out.filter(x=>/(MG|MCG|UI|%)$/.test(x)); if(!activos.length) return "";
    return [...new Set(out)].sort().join("+"); }
  function _via(x){ if(/OFTALMIC|COLIRIO|OCULAR|\bOFT\b/.test(x))return"OFT"; if(/OTICA|\bOTIC\b|\bOTI\b|\bOIDO/.test(x))return"OTI"; if(/NASAL|\bNAS\b/.test(x))return"NAS"; if(/VAGINAL|\bVAG\b|\bOVULO/.test(x))return"VAG"; if(/RECTAL/.test(x))return"REC"; return""; }
  function _formaBase(x){
    if(/CAPSULA|\bCAPS\b|\bCAPS\./.test(x)) return "CAPS";
    if(/COMPRIMIDO|\bCOMPR?\b|\bCOMP\b|\bCOMP\.|GRAGEA|\bTABLETA|\bTAB\b|\bTAB\.|\bCP\b/.test(x)) return "COMP";
    if(/PARCHE|TRANSDERMIC/.test(x)) return "PARCHE";
    if(/JARABE|\bJBE\b|SUSPENSION|\bSUSP\b|PVO.*SUSP|POLVO.*SUSP/.test(x)) return "JBE";
    if(/\bGOTAS\b/.test(x)) return "GOTAS";
    if(/\bGEL\b/.test(x)) return "GEL";
    if(/CREMA|POMADA|UNGUENTO|JALEA|LOCION/.test(x)) return "TOPICO";
    if(/\bOVULO/.test(x)) return "OVULO";
    if(/SUPOSITORIO|\bSUP\b/.test(x)) return "SUP";
    if(/AEROSOL|\bAER\b|INHALAD|\bHFA\b|\bDS\b|SPRAY|\bPUFF/.test(x)) return "INHAL";
    if(/CARAMELO|CARAM/.test(x)) return "CARAM";
    if(/SOBRE|SACHET|GRANULOS/.test(x)) return "SOBRE";
    if(/AMPOLLA|\bAMP\b|\bAMP\.|F\/?A\b|F\.A\.|FCO.*AMP|FRASCO.*AMP|\bVIAL\b|LIOF|\bINY|I\.?M\b|I\.?V\b/.test(x)) return "INY";
    if(/SOLUCION|\bSOL\.?\b|\bLT\b|LITRO|\bML\b/.test(x)) return "LIQ";
    return ""; }
  function formaMed(name,categ){ const s=_stripN(name), c=_stripN(categ);
    let base=_formaBase(s)||_formaBase(c); const via=_via(s);
    if(!base){ return via?("LIQ-"+via):"?"; }
    const mods=[]; if(/SUBLINGUAL|\bSUBL\b/.test(s))mods.push("SUBL");
    if(/RETARD|\bXR\b|\bXL\b|\bER\b|\bSR\b|PROLONGAD|ACCION\s+PROLONG|LIB\.?\s*PROLONG|LIBERACION\s+PROLONG|\bA\.?P\.?\b|\bLP\b/.test(s))mods.push("LP");
    if(/MASTICABLE|MASTIC/.test(s))mods.push("MAST");
    if(/EFERVESCENTE|EFERV/.test(s))mods.push("EFV");
    if(/DISPERSABLE|DISPER|BUCODISP/.test(s))mods.push("DISP");
    return base+(via?"-"+via:"")+(mods.length?"-"+mods.sort().join("-"):""); }
  function drogaKey(r){ if(!r.monodrug) return null; const dr=_stripN(r.monodrug).replace(/\s+/g," ").trim(); if(!dr) return null;
    const cf=concMed(r.name), fo=formaMed(r.name, r.categ); if(!cf || fo==="?") return null; return "RX::"+dr+"|"+cf+"|"+fo; }
  function grpKey(r){ const rx=drogaKey(r); if(rx) return rx; const n=nucleoProd(r.name, r.categ); return n ? ((r.categ||"")+"||"+n) : ("SOLO#"+r.id); }
  /* arma grupos sobre las filas: cuelga r.g (agregados) y r.esVig (marca vigente) */
  function agrupar(rows){
    BRANDS = new Set(rows.map(r=>_stripN(r.marca).replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim()).filter(b=>b.length>=3));
    const GB={}; for(const r of rows){ (GB[grpKey(r)]=GB[grpKey(r)]||[]).push(r); }
    for(const k in GB){ const ms=GB[k];
      const venta=ms.reduce((a,r)=>a+(r.ventaU||0),0), venta3=ms.reduce((a,r)=>a+(r.venta3||0),0), qty=ms.reduce((a,r)=>a+(r.qty||0),0);
      let vig=ms[0], best=-1; for(const r of ms){ const sc=(r.qty>0?2:0)+(r.ventaU/1e9); if(sc>best){best=sc;vig=r;} }
      const g={venta,venta3,qty,n:ms.length,vigId:vig.id};
      for(const r of ms){ r.g=g; r.esVig=(r.id===vig.id); } }
  }

  /* candidatos group-aware a partir de filas ya agrupadas (cada fila con r.g y r.esVig). */
  function rankGrupo(rows, opts){
    opts = opts||{}; const ig=new Set(opts.ignora||[]), of=new Set(opts.enOferta||[]);
    return rows.filter(r=> r.qty>0 && r.activo!==false && !r.xop && !r.xarch && !ig.has(r.id) && !of.has(r.id)).map(r=>{
      const g=r.g||{venta:r.ventaU,venta3:r.venta3,qty:r.qty,n:1};
      const gMeses = g.venta>0 ? g.qty/(g.venta/12) : 999;          // cobertura del PRODUCTO (todas las marcas)
      const cu = r.qty>0 ? r.val/r.qty : 0;
      const nearExp = (r.val6>0 && r.min!=null && gMeses>r.min);     // vence antes de que el GRUPO lo venda
      let motivo=null;
      if(nearExp) motivo="vence";
      else if(g.venta===0) motivo="muerto";                          // el producto entero no vende
      else if(r.esVig===false && r.qty>0 && r.venta3===0 && gMeses<12) motivo="discontinuada"; // marca vieja PARADA (0 ventas 3m); el producto rota por otra marca
      else if((g.venta3===0 && gMeses>12) || gMeses>36) motivo="clavado";
      else if(gMeses>12) motivo="sobre";
      if(!motivo) return null;
      // plata a recuperar: en sobrestock el EXCEDENTE del grupo prorrateado a esta marca; en el resto, todo el stock de esta marca
      let recuperable;
      if(motivo==="sobre"){ const exc=Math.max(0,g.qty-Math.round(g.venta/12*3)); recuperable=Math.round(r.val*(g.qty>0?exc/g.qty:0)); }
      else recuperable=Math.round(r.val);
      const score=Math.round(recuperable*(URG[motivo]||1));
      return {...r, cu, gMeses:gMeses>900?999:Math.round(gMeses*10)/10, motivo, recuperable, unid:r.qty, score, liquidar: motivo!=="sobre"};
    }).filter(r=> r && r.score>0).sort((a,b)=>b.score-a.score).slice(0,40);
  }

  /* candidatos → ítems finales con precio sugerido. */
  function finalize(cands, baseByTmpl, opts){
    baseByTmpl = baseByTmpl||{}; opts=opts||{};
    const DESCX = opts.desc||DESC, MAX = opts.max>0?opts.max:10, MLIQ = opts.margenLiq>0?opts.margenLiq:MARGEN_LIQ;
    return cands.map(r=>{
      const base = baseByTmpl[r.tmpl]!=null ? baseByTmpl[r.tmpl] : r.pvp;
      const costo = r.costoU>0 ? r.costoU : (r.sp>0 ? r.sp : r.cu);
      const piso = Math.round(costo*1.05);
      let sug;
      if(r.liquidar){ sug = Math.round(costo*(1+MLIQ)); }
      else { const d=(DESCX[r.motivo]!=null?DESCX[r.motivo]:DESC[r.motivo]); sug=Math.round(base*(1-d)); if(sug<piso) sug=piso; }
      const margenAbs = Math.round(sug - costo), margenPct = (sug>0 && costo>0) ? Math.round((sug-costo)/sug*100) : null;
      const gm = r.gMeses!=null&&r.gMeses<900 ? r.gMeses : null;
      const motTxt = r.motivo==="vence" ? `Vence en ${r.min}m y al ritmo del producto no llega a venderse`
        : r.motivo==="muerto" ? `Sin ventas en los últimos 12 meses (todo el producto)`
        : r.motivo==="discontinuada" ? `Marca discontinuada: hay saldo pero el producto se vende por otra marca`
        : r.motivo==="clavado" ? `Clavado: ${gm!=null?gm+"m de stock":"sin venta"} y nada vendido en 3 meses`
        : `Sobrestock: ${gm!=null?gm+" meses de stock":"alto"}`;
      return { id:r.id, tmpl:r.tmpl, sku:r.code, nombre:cleanName(r.name), cat:r.fam,
        stock:r.qty, unid:r.unid||r.qty, meses:gm, min:r.min, valor:Math.round(r.val), recuperable:r.recuperable,
        motivo:r.motivo, liquidar:!!r.liquidar, motivoTxt:motTxt, precio:Math.round(base), costoU:Math.round(costo),
        desc: base>0?Math.round((1-sug/base)*100)/100:0, sugPrecio:sug, margenAbs, margenPct };
    }).filter(r=> r.precio>r.costoU*1.25 && r.precio<r.costoU*6).slice(0,MAX); // margen para un descuento real (sino la "oferta casi al costo" no descuenta nada)
  }

  async function fetchBase(rpc, tmpls){
    const baseByTmpl = {}; if(!tmpls.length) return baseByTmpl;
    const pit = await rpc("product.pricelist.item","search_read",
      [[["pricelist_id","=",LISTA],["applied_on","=","1_product"],["product_tmpl_id","in",tmpls]]],
      {fields:["product_tmpl_id","min_quantity","fixed_price"], limit:20000});
    const tmp={}; for(const it of pit){ const t=it.product_tmpl_id[0]; if(!tmp[t]||it.min_quantity<tmp[t].q) tmp[t]={q:it.min_quantity,p:it.fixed_price}; }
    for(const t in tmp) baseByTmpl[t]=tmp[t].p;
    return baseByTmpl;
  }

  /* Detección completa group-aware. Para oportunidades.html. */
  async function detectar(rpc, opts){
    const HOY=new Date(); HOY.setHours(0,0,0,0);
    const iso=d=>d.toISOString().slice(0,10);
    const ini12=new Date(HOY.getFullYear(),HOY.getMonth()-12,1);
    const ini3 =new Date(HOY.getFullYear(),HOY.getMonth()-3,1);
    const [stock,ventas,ventas3]=await Promise.all([
      rpc("stock.quant","read_group",[[["location_id.usage","=","internal"],["quantity",">",0]],["value:sum","quantity:sum"],["product_id"]],{lazy:false,limit:6000}),
      rpc("sale.order.line","read_group",[[["order_id.state","in",["sale","done"]],["order_id.date_order",">=",iso(ini12)]],["product_uom_qty:sum"],["product_id"]],{lazy:false,limit:9000}),
      rpc("sale.order.line","read_group",[[["order_id.state","in",["sale","done"]],["order_id.date_order",">=",iso(ini3)]],["product_uom_qty:sum"],["product_id"]],{lazy:false,limit:9000}),
    ]);
    const V={},V3={}; for(const v of ventas){ if(v.product_id) V[v.product_id[0]]=v.product_uom_qty||0; }
    for(const v of ventas3){ if(v.product_id) V3[v.product_id[0]]=v.product_uom_qty||0; }
    // para agrupar bien necesitamos TODAS las marcas del producto, incluidas las que venden sin stock (quiebres)
    const stockIds=stock.filter(s=>s.product_id).map(s=>s.product_id[0]); const stockSet=new Set(stockIds);
    const extra=Object.keys(V).map(Number).filter(id=>V[id]>0 && !stockSet.has(id));
    const allIds=[...stockIds, ...extra];
    const [meta,quantsLote]=await Promise.all([
      rpc("product.product","read",[allIds,["categ_id","default_code","name","standard_price","list_price","product_tmpl_id","active","x_oportunidad","x_oportunidad_archivada","x_costo_motor","x_iva_compra","taxes_id","monodrug","x_studio_many2one_field_6o_1if0l6ud2"]]),
      rpc("stock.quant","search_read",[[["location_id.usage","=","internal"],["quantity",">",0],["lot_id","!=",false]],["product_id","lot_id","quantity","value"]],{limit:6000}),
    ]);
    const M={}; for(const m of meta) M[m.id]=m;
    const taxIds=[...new Set(meta.flatMap(m=>m.taxes_id||[]))];
    const taxes=taxIds.length?await rpc("account.tax","read",[taxIds,["amount"]]):[];
    const TAX={}; for(const t of taxes) TAX[t.id]=t;
    const vendeExento=m=>{ const ts=(m.taxes_id||[]).map(id=>TAX[id]).filter(Boolean); return ts.length?ts.every(t=>(t.amount||0)===0):false; };
    const QV={},QQ={}; for(const s of stock){ if(s.product_id){ QV[s.product_id[0]]=s.value||0; QQ[s.product_id[0]]=s.quantity||0; } }
    const lotIds=[...new Set(quantsLote.filter(q=>q.lot_id).map(q=>q.lot_id[0]))];
    const lotes = lotIds.length ? await rpc("stock.lot","read",[lotIds,["expiration_date","name"]]) : [];
    const L={}; for(const l of lotes) L[l.id]=l;
    const vencP={};
    for(const q of quantsLote){ if(!q.product_id||!q.lot_id) continue; const pid=q.product_id[0], lot=L[q.lot_id[0]]||{};
      const mh=lot.expiration_date?mesesHasta(lot.expiration_date,HOY):null;
      const vp=vencP[pid]||(vencP[pid]={v6:0,min:9999}); if(mh!=null){ if(mh<vp.min)vp.min=mh; if(mh>=0&&mh<6)vp.v6+=q.value; } }
    const rows=allIds.map(id=>{ const m=M[id]||{}, vp=vencP[id]||{};
      const val=Math.round(QV[id]||0), qty=Math.round(QQ[id]||0), ventaU=Math.round(V[id]||0), venta3=Math.round(V3[id]||0), meses=ventaU>0?qty/(ventaU/12):999;
      const net=(m.x_costo_motor||0)>0?m.x_costo_motor:(m.standard_price||0);
      const costoU=Math.round(net*(1+(vendeExento(m)?(m.x_iva_compra||0):0)));
      return {id, tmpl:m.product_tmpl_id?m.product_tmpl_id[0]:null, activo:m.active!==false, xop:!!m.x_oportunidad, xarch:!!m.x_oportunidad_archivada,
        code:m.default_code||"", name:(m.name||""), categ:m.categ_id?m.categ_id[1]:"", fam:familia(m.categ_id),
        marca:(Array.isArray(m.x_studio_many2one_field_6o_1if0l6ud2)?(m.x_studio_many2one_field_6o_1if0l6ud2[1]||""):""),
        monodrug:(Array.isArray(m.monodrug)?(m.monodrug[1]||""):(typeof m.monodrug==="string"?m.monodrug:"")),
        val, qty, ventaU, venta3, meses:meses>900?999:Math.round(meses*10)/10, pvp:m.list_price||0, sp:m.standard_price||0, costoU,
        min:(vp.min!==undefined&&vp.min<9999)?Math.round(vp.min*10)/10:null, val6:Math.round(vp.v6||0)}; });
    agrupar(rows);                                   // cuelga r.g (grupo) y r.esVig
    const cands=rankGrupo(rows, opts);               // solo los que tienen stock y motivo group-aware
    const base=await fetchBase(rpc, [...new Set(cands.map(r=>r.tmpl).filter(Boolean))]);
    return finalize(cands, base, opts);
  }

  return { LISTA, DESC, MARGEN_LIQ, URG, agrupar, grpKey, nucleoProd, drogaKey, rankGrupo, finalize, fetchBase, detectar };
})();
