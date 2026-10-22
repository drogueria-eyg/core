/* =====================================================================
   EYGOfRend — RENDIMIENTO DE TODAS LAS OFERTAS (22/10/2026)
   Una sola cuenta para la tarjeta "🎯 Ofertas que se compran" (Oportunidades) y la de Inicio.
   Entran las tres fuentes: Oportunidades (sincronizador), combos y ofertas del panel, y la capa
   temporal del Motor de precios (listas 1, 2 y 3).

   CUÁNDO ESTUVO VIGENTE cada oferta: parámetro eyg.ofertas_vigencias, que escribe cada hora el
   cron de Odoo "EyG · Registro de vigencias de ofertas" (eyg-core-cron/cron_vigencias_ofertas.py).
   Antes del 22/10/2026 las vigencias de Oportunidades y combos están reconstruidas (alta y
   vencimiento, sin pausas) y la capa no se registraba.

   QUÉ CUENTA COMO VENTA DE UNA OFERTA (exacto, sin estimar):
   · COMBO: los renglones que Cargar venta marca con el código del combo ("Combo CB0008" al final
     del texto del renglón). Combos vendidos = unidades del primer producto ÷ las de la receta.
   · OFERTA DE UN PRODUCTO (Oportunidades, panel o capa): renglón de pedido CONFIRMADO de ese
     producto, el día (hora argentina) en que la oferta estaba vigente, en un pedido con la lista
     de precios donde la oferta rige (capa lista 1 → Farmacias; Oportunidades → lista 1 y las
     institucionales si se copió). Si el producto está a la vez en Oportunidades y en la capa,
     manda Oportunidades, igual que en el motor. Los renglones de un combo no se cuentan sueltos.
   · Facturado = subtotal neto (sin IVA) del renglón. Un presupuesto no cuenta.
   ===================================================================== */
(function(){
  const LISTA_NOM={3:"Farmacias",16:"SAMCOs y clínicas",5:"Instituciones"};
  const FUENTE={op:"Oportunidades", panel:"Panel", combo:"Combo", capa:"Capa del Motor"};
  const rpc=(...a)=>EYG.rpc(...a);
  const diaAR=s=>{ if(!s) return ""; return new Date(new Date(String(s).replace(" ","T")+"Z").getTime()-3*3600e3).toISOString().slice(0,10); };
  const masDias=(d,n)=>{ const x=new Date(d+"T12:00:00Z"); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); };
  const trozos=(a,n)=>{ const r=[]; for(let i=0;i<a.length;i+=n) r.push(a.slice(i,i+n)); return r; };
  const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/\s+/g," ").trim();

  async function leerVigencias(){
    const v=await rpc("ir.config_parameter","get_param",["eyg.ofertas_vigencias"]);
    const R=v?JSON.parse(v):null;
    if(!R||!R.o) throw new Error("todavía no hay registro de vigencias");
    return R;
  }
  // días [desde,hasta] de la oferta que caen dentro del período
  function diasEn(o,desde,hasta){
    let n=0; (o.d||[]).forEach(([a,b])=>{ const x=a>desde?a:desde, y=b<hasta?b:hasta;
      if(x<=y) n+=Math.round((new Date(y+"T12:00:00Z")-new Date(x+"T12:00:00Z"))/864e5)+1; });
    return n;
  }
  const vigenteEl=(o,dia)=>(o.d||[]).some(([a,b])=>a<=dia&&dia<=b);

  /* medir({desde, hasta}) → { ofertas:[...], tot:{...}, porFuente:{...}, R } (fechas AAAA-MM-DD, inclusive) */
  async function medir(opt){
    const hasta=opt.hasta||EYG.argToday(), desde=opt.desde;
    const R=await leerVigencias();
    const of=Object.entries(R.o).map(([k,o])=>Object.assign({key:k},o))
      .filter(o=>o.f==="combo" || diasEn(o,desde,hasta)>0);
    // plantillas → variantes
    const tms=[...new Set(of.flatMap(o=>o.tm||[]))];
    const tv={};
    for(const ch of trozos(tms,800)){
      const vs=await rpc("product.product","search_read",[[["product_tmpl_id","in",ch]]],{fields:["id","product_tmpl_id"],limit:0,context:{active_test:false}});
      vs.forEach(v=>(tv[v.product_tmpl_id[0]]=tv[v.product_tmpl_id[0]]||[]).push(v.id));
    }
    of.forEach(o=>{ o._pv=new Set([...(o.pv||[]), ...(o.tm||[]).flatMap(t=>tv[t]||[])]); o._l=new Set(o.l||[3]); });
    const porPv={}; of.forEach(o=>{ if(o.f==="combo") return; o._pv.forEach(p=>(porPv[p]=porPv[p]||[]).push(o)); });
    const prio=o=>o.f==="capa"?2:1;
    Object.values(porPv).forEach(a=>a.sort((x,y)=>prio(x)-prio(y)));
    const combos=of.filter(o=>o.f==="combo");
    const pvs=[...new Set([...Object.keys(porPv).map(Number), ...combos.flatMap(o=>[...o._pv])])];
    // renglones confirmados de esos productos en el período (con un día de margen por la hora argentina)
    const dom0=[["state","in",["sale","done"]],["order_id.date_order",">=",desde+" 03:00:00"],["order_id.date_order","<",masDias(hasta,1)+" 03:00:00"]];
    let lineas=[];
    for(const ch of trozos(pvs,600)){
      const ls=await rpc("sale.order.line","search_read",[[["product_id","in",ch],...dom0]],
        {fields:["order_id","order_partner_id","product_id","product_uom_qty","price_unit","discount","price_subtotal","name"],limit:0});
      lineas=lineas.concat(ls||[]);
    }
    /* COMBOS: Cargar venta marca CADA renglón del combo con su código al final del texto del renglón
       ("… Combo CB0008", en una línea aparte). Esa marca es la que vale: la nota aparte que escribe
       antes no queda en el pedido. Se buscan también los renglones marcados de productos que no
       estaban en la lista. */
    const COMBO_RE=/\bCombo\s+(CB\d{4})\b/;
    const ya=new Set(lineas.map(l=>l.id));
    const marcados=await rpc("sale.order.line","search_read",[[["name","ilike","Combo CB"],...dom0]],
      {fields:["order_id","order_partner_id","product_id","product_uom_qty","price_unit","discount","price_subtotal","name"],limit:0});
    (marcados||[]).forEach(l=>{ if(!ya.has(l.id)){ ya.add(l.id); lineas.push(l); } });
    const ords=[...new Set(lineas.map(l=>l.order_id[0]))];
    const cab={};
    for(const ch of trozos(ords,800)){
      const os=await rpc("sale.order","read",[ch,["date_order","pricelist_id","partner_id","name"]]);
      (os||[]).forEach(o=>cab[o.id]={dia:diaAR(o.date_order), lista:o.pricelist_id&&o.pricelist_id[0], cli:o.partner_id&&o.partner_id[0], cliN:o.partner_id&&o.partner_id[1], nom:o.name});
    }
    const ag=new Map(of.map(o=>[o.key,{o, ped:new Set(), cli:new Map(), un:0, plata:0, combos:0, renglones:0, _ref:{}}]));
    const comboCod={}; combos.forEach(o=>{ if(o.cod) comboCod[o.cod]=o; });
    const enCombo=new Set();
    lineas.forEach(l=>{
      const m=COMBO_RE.exec(String(l.name||"")); if(!m) return;
      enCombo.add(l.id);   // un renglón de combo nunca cuenta como oferta suelta
      const o=comboCod[m[1]], c=cab[l.order_id[0]]; if(!o||!c||c.dia<desde||c.dia>hasta) return;
      const g=ag.get(o.key);
      g.ped.add(l.order_id[0]); g.cli.set(c.cli,c.cliN); g.un+=l.product_uom_qty||0; g.plata+=l.price_subtotal||0; g.renglones++;
      // cuántos combos: las unidades del PRIMER producto de la receta ÷ lo que lleva un combo
      if(l.product_id && o.pv && l.product_id[0]===o.pv[0]) g._ref[l.order_id[0]]=(g._ref[l.order_id[0]]||0)+(l.product_uom_qty||0);
    });
    ag.forEach(g=>{ if(g.o.f!=="combo") return; const q0=(g.o.q&&g.o.q[0])||1;
      g.combos=Object.values(g._ref).reduce((s,u)=>s+Math.round(u/q0),0); });
    // ---- ofertas de un producto ----
    lineas.forEach(l=>{
      if(enCombo.has(l.id)) return;
      const c=cab[l.order_id[0]]; if(!c||c.dia<desde||c.dia>hasta) return;
      const cands=porPv[l.product_id[0]]; if(!cands) return;
      const o=cands.find(x=>vigenteEl(x,c.dia) && x._l.has(c.lista)); if(!o) return;
      const g=ag.get(o.key);
      g.ped.add(l.order_id[0]); g.cli.set(c.cli,c.cliN); g.un+=l.product_uom_qty||0; g.plata+=l.price_subtotal||0; g.renglones++;
    });
    // ---- armado ----
    const filas=[...ag.values()].filter(g=>g.o.f!=="combo"||g.combos||diasEn(g.o,desde,hasta)>0).map(g=>({
      key:g.o.key, fuente:g.o.f, fuenteN:FUENTE[g.o.f]||g.o.f, titulo:g.o.t||g.o.key, codigo:g.o.cod||"",
      listas:(g.o.l||[]).map(x=>LISTA_NOM[x]||("lista "+x)), dias:diasEn(g.o,desde,hasta),
      pedidos:g.ped.size, clientes:g.cli.size, quien:[...g.cli.values()].filter(Boolean),
      unidades:g.un, facturado:g.plata, combos:g.combos,
      vigenteHoy:vigenteEl(g.o,EYG.argToday()) }));
    filas.sort((a,b)=>(b.facturado-a.facturado)||(b.clientes-a.clientes)||a.titulo.localeCompare(b.titulo));
    const conV=filas.filter(f=>f.pedidos);
    const cliT=new Set(), pedT=new Set();
    [...ag.values()].forEach(g=>{ g.cli.forEach((_,k)=>cliT.add(k)); g.ped.forEach(p=>pedT.add(p)); });
    const porFuente={};
    filas.forEach(f=>{ const k=f.fuente==="panel"?"op":f.fuente; const x=porFuente[k]||(porFuente[k]={n:0,conVenta:0,facturado:0,clientes:new Set()});
      x.n++; if(f.pedidos){ x.conVenta++; x.facturado+=f.facturado; } });
    [...ag.values()].forEach(g=>{ const k=g.o.f==="panel"?"op":g.o.f; if(porFuente[k]) g.cli.forEach((_,c)=>porFuente[k].clientes.add(c)); });
    Object.values(porFuente).forEach(x=>x.clientes=x.clientes.size);
    return { desde, hasta, ofertas:filas,
      tot:{ ofertas:filas.length, conVenta:conV.length, facturado:conV.reduce((s,f)=>s+f.facturado,0),
            clientes:cliT.size, pedidos:pedT.size, unidades:conV.reduce((s,f)=>s+f.unidades,0),
            combos:filas.reduce((s,f)=>s+f.combos,0) },
      porFuente, inicio:R.inicio, nota:R.reconstruido||"" };
  }
  window.EYGOfRend={ medir, FUENTE, LISTA_NOM };
})();
