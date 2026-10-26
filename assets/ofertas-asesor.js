/* =====================================================================
   EYGAsesor — 🧠 ASESOR DE OFERTAS (26/10/2026)
   Cruza todo lo que el Core sabe de cada producto con stock y propone, una tras otra, las
   mejores ofertas para armar, y mejoras para las que ya están publicadas.

   QUÉ MIRA (todo de Odoo, en vivo; el análisis pesado se guarda 6 h en el caché compartido):
   · stock y capital inmovilizado (stock.quant: unidades, valor a costo, fecha de ingreso)
   · rotación: unidades 12 meses / 3 meses / 30 días, por producto y por GRUPO (mismo producto de
     otra marca o misma droga, con la agrupación de EYGOpo: no se liquida un producto que rota por
     otra marca)
   · clientes distintos que lo compraron en 90 días (amplitud de la demanda)
   · TEMPORADA medida: lo que vendió el año pasado en los próximos 3 meses contra su promedio, y
     ÉPOCA DEL AÑO (conocimiento: verano/invierno/alergias en Argentina) cuando no hay historia
   · vencimientos por lote (lo que vence antes de que el grupo lo venda)
   · compras recientes (stock fresco no se liquida) y baja de costo (x_oportunidad)
   · costo EFECTIVO (mismo que el motor), precio publicado lista 1, PVP (éticos), piso de margen
     de la categoría (el del motor), destino farmacias/instituciones (EYGCanal)
   · las ofertas activas y su rendimiento (EYGOfRend): sin ventas, por vencer y rinde, bajo costo,
     sin placa → propone la mejora concreta.
   · combos: para lo que está quieto, el producto que MÁS se compra junto con él (mismos pedidos).

   PRECIOS QUE PROPONE (exactos, como los publica el motor):
   · éticos: PVP × (1 − % ENTERO), al centavo (el % que muestra la placa cuadra exacto)
   · resto: al centavo. Nunca debajo del piso de la categoría, salvo liquidar (vence o stock muerto),
     que puede bajar hasta costo + 3-5% y lo avisa ("perfora el piso": el editor pide confirmar).
   Confirmar abre el editor de siempre con todo cargado: los controles de costo/piso y el guardado
   son los mismos de cualquier oferta.
   ===================================================================== */
(function(){
  const LISTA=3, CACHE_TTL=21600, VERSION="v3";
  const r2=x=>Math.round((+x||0)*100)/100;
  const diasDesde=f=>f?Math.max(0,Math.round((Date.now()-new Date(String(f).replace(" ","T")+"Z").getTime())/864e5)):null;
  const isoMenos=d=>new Date(Date.now()-d*864e5).toISOString().slice(0,10);
  const trozos=(a,n)=>{ const r=[]; for(let i=0;i<a.length;i+=n) r.push(a.slice(i,i+n)); return r; };

  /* ---------- ÉPOCA DEL AÑO (Argentina, hemisferio sur) ----------
     Se usa SOLO cuando el producto no tiene historia del año pasado para medir su temporada. */
  const EPOCAS=[
    {nom:"verano", meses:[11,12,1,2], re:/REPELENT|PROTECTOR SOLAR|PANTALLA SOLAR|\bFPS\b|\bSOLAR\b|AFTER ?SUN|ALOE VERA|PICADURA|CALAMINA|SALES DE REHIDRAT|REHIDRATA|SUERO ORAL|LOPERAMIDA|RACECADOTRILO|ANTIMICOT|CLOTRIMAZOL|TERBINAFINA|MICONAZOL|KETOCONAZOL|PEDICUL|PERMETRINA/},
    {nom:"alergias de primavera", meses:[9,10,11], re:/LORATADINA|DESLORATADINA|CETIRIZINA|LEVOCETIRIZINA|FEXOFENADINA|BILASTINA|ANTIHISTAM|OLOPATADINA|MOMETASONA NASAL|BUDESONIDA NASAL|FLUTICASONA NASAL/},
    {nom:"invierno", meses:[5,6,7,8], re:/ANTIGRIPAL|GRIPE|\bTOS\b|ANTITUSIV|DEXTROMETORFANO|AMBROXOL|BROMHEXINA|CARBOCISTEINA|DESCONGEST|PSEUDOEFEDRINA|FENILEFRINA|VITAMINA C|ACIDO ASCORBICO|NEBULIZ|SALBUTAMOL|OSELTAMIVIR/},
  ];
  function epocaDe(nombre){
    const m=new Date().getMonth()+1, prox=[m, m%12+1, (m+1)%12+1];   // este mes y los dos que vienen
    const n=String(nombre||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase();
    for(const e of EPOCAS){ if(e.re.test(n) && prox.some(x=>e.meses.includes(x))) return e.nom; }
    return "";
  }

  /* ---------- 1. DATOS (pesado: una vez cada 6 h, compartido) ---------- */
  async function datos(forzar){
    const hoy=EYG.argToday(), key="asesor-"+VERSION+"-"+hoy;
    if(forzar && EYG.cacheOlvidar) try{ await EYG.cacheOlvidar(key); }catch(e){}
    return EYG.cacheOdoo(key, CACHE_TTL, async()=>{
      const rpc=EYG.rpc, est=["order_id.state","in",["sale","done"]];
      const now=new Date(), ly0=new Date(now.getFullYear()-1,now.getMonth(),now.getDate()), ly1=new Date(now.getFullYear()-1,now.getMonth()+3,now.getDate());
      const iso=d=>d.toISOString().slice(0,10);
      const [stock,v12,v3,v30,cli,tly,compras]=await Promise.all([
        rpc("stock.quant","read_group",[[["location_id.usage","=","internal"],["quantity",">",0]],["value:sum","quantity:sum","in_date:min"],["product_id"]],{lazy:false,limit:9000}),
        rpc("sale.order.line","read_group",[[est,["order_id.date_order",">=",isoMenos(365)]],["product_uom_qty:sum","price_subtotal:sum"],["product_id"]],{lazy:false,limit:12000}),
        rpc("sale.order.line","read_group",[[est,["order_id.date_order",">=",isoMenos(91)]],["product_uom_qty:sum"],["product_id"]],{lazy:false,limit:12000}),
        rpc("sale.order.line","read_group",[[est,["order_id.date_order",">=",isoMenos(30)]],["product_uom_qty:sum"],["product_id"]],{lazy:false,limit:12000}),
        rpc("sale.order.line","read_group",[[est,["order_id.date_order",">=",isoMenos(90)]],["product_uom_qty:sum"],["product_id","order_partner_id"]],{lazy:false,limit:60000}),
        rpc("sale.order.line","read_group",[[est,["order_id.date_order",">=",iso(ly0)],["order_id.date_order","<",iso(ly1)]],["product_uom_qty:sum"],["product_id"]],{lazy:false,limit:12000}),
        rpc("purchase.order.line","read_group",[[["order_id.state","in",["purchase","done"]],["order_id.date_order",">=",isoMenos(122)]],["product_qty:sum"],["product_id"]],{lazy:false,limit:12000}),
      ]);
      const map=(rows,f)=>{ const m={}; (rows||[]).forEach(r=>{ if(r.product_id) m[r.product_id[0]]=f(r); }); return m; };
      const V12=map(v12,r=>r.product_uom_qty||0), P12=map(v12,r=>r.price_subtotal||0), V3=map(v3,r=>r.product_uom_qty||0), V30=map(v30,r=>r.product_uom_qty||0), TLY=map(tly,r=>r.product_uom_qty||0);
      const CLI={}; (cli||[]).forEach(r=>{ if(r.product_id) CLI[r.product_id[0]]=(CLI[r.product_id[0]]||0)+1; });
      const REC=new Set((compras||[]).filter(c=>c.product_id&&(c.product_qty||0)>0).map(c=>c.product_id[0]));
      const ST={}; (stock||[]).forEach(s=>{ if(s.product_id) ST[s.product_id[0]]={qty:s.quantity||0, val:s.value||0, in:s.in_date||""}; });
      // para agrupar bien hacen falta también las marcas que venden sin stock
      const ids=[...new Set(Object.keys(ST).map(Number).concat(Object.keys(V12).map(Number)))];
      let meta=[];
      for(const ch of trozos(ids,700)) meta=meta.concat(await rpc("product.product","read",[ch,["name","default_code","categ_id","product_tmpl_id","active","x_costo_motor","x_iva_compra","taxes_id","list_price","standard_price","monodrug","x_studio_many2one_field_6o_1if0l6ud2","x_oportunidad","x_oportunidad_archivada","x_oportunidad_costo_ant"]],{context:{lang:"es_AR"}})||[]);
      // lotes: lo que vence antes
      const ql=await rpc("stock.quant","search_read",[[["location_id.usage","=","internal"],["quantity",">",0],["lot_id","!=",false]],["product_id","lot_id","quantity","value"]],{limit:9000});
      const lotIds=[...new Set((ql||[]).map(q=>q.lot_id&&q.lot_id[0]).filter(Boolean))];
      let lotes=[]; for(const ch of trozos(lotIds,800)) lotes=lotes.concat(await rpc("stock.lot","read",[ch,["expiration_date"]])||[]);
      const LV={}; lotes.forEach(l=>LV[l.id]=l.expiration_date||"");
      const VEN={};
      (ql||[]).forEach(q=>{ const f=LV[q.lot_id[0]]; if(!f) return; const pid=q.product_id[0];
        const meses=(new Date(f.slice(0,10))-new Date(hoy))/864e5/30.44;
        const v=VEN[pid]||(VEN[pid]={min:999,qty6:0,val6:0,fecha:""});
        if(meses<v.min){ v.min=meses; v.fecha=f.slice(0,10); }
        if(meses<6){ v.qty6+=q.quantity||0; v.val6+=q.value||0; } });
      // precios publicados lista 1 (tramos) por plantilla
      const tmpls=[...new Set(meta.map(m=>m.product_tmpl_id&&m.product_tmpl_id[0]).filter(Boolean))];
      const TR={};
      for(const ch of trozos(tmpls,900)){
        const its=await rpc("product.pricelist.item","search_read",[[["pricelist_id","=",LISTA],["product_tmpl_id","in",ch]]],{fields:["product_tmpl_id","min_quantity","fixed_price"],limit:20000});
        (its||[]).forEach(i=>(TR[i.product_tmpl_id[0]]=TR[i.product_tmpl_id[0]]||[]).push({q:Math.round(i.min_quantity||1)||1,p:i.fixed_price}));
      }
      Object.values(TR).forEach(a=>a.sort((x,y)=>x.q-y.q));
      const tasas=await EYG.tasasVenta();
      const rows=meta.map(m=>{ const id=m.id, s=ST[id]||{qty:0,val:0,in:""}, v=VEN[id];
        const c=+m.x_costo_motor>0?+m.x_costo_motor:0;
        const costo=c>0?(EYG.vendeExento(m.taxes_id,tasas)?c*(1+(+m.x_iva_compra||0)):c):0;
        const cat=(m.categ_id&&m.categ_id[1])||"";
        return { id, tmpl:m.product_tmpl_id&&m.product_tmpl_id[0], name:m.name||"", code:m.default_code||"", catId:m.categ_id&&m.categ_id[0], categ:cat,
          activo:m.active!==false, costo:r2(costo), pvp:/[EÉ]TICO/i.test(cat)?(+m.list_price||0):0,
          marca:Array.isArray(m.x_studio_many2one_field_6o_1if0l6ud2)?(m.x_studio_many2one_field_6o_1if0l6ud2[1]||""):"",
          monodrug:Array.isArray(m.monodrug)?(m.monodrug[1]||""):(typeof m.monodrug==="string"?m.monodrug:""),
          qty:Math.round(s.qty), val:Math.round(s.val), inDate:s.in,
          ventaU:Math.round(V12[id]||0), plata12:Math.round(P12[id]||0), venta3:Math.round(V3[id]||0), v30:Math.round(V30[id]||0),
          cli90:CLI[id]||0, tly:Math.round(TLY[id]||0), compraReciente:REC.has(id), seasonal:(TLY[id]||0)>0,
          vMin:v&&v.min<999?Math.round(v.min*10)/10:null, vFecha:v?v.fecha:"", qty6:v?Math.round(v.qty6):0, val6:v?Math.round(v.val6):0,
          xop:!!m.x_oportunidad, xarch:!!m.x_oportunidad_archivada, costoAnt:+m.x_oportunidad_costo_ant||0,
          tramos:(m.product_tmpl_id&&TR[m.product_tmpl_id[0]])||[] }; });
      return { fecha:new Date().toISOString(), rows };
    });
  }

  /* compañero de combo: lo que más se compra en los MISMOS pedidos (12 meses) */
  async function companeros(pids){
    const out={};
    for(const pid of pids){
      try{
        const ls=await EYG.rpc("sale.order.line","search_read",[[["product_id","=",pid],["order_id.state","in",["sale","done"]],["order_id.date_order",">=",isoMenos(365)]]],{fields:["order_id"],limit:300});
        const ords=[...new Set((ls||[]).map(l=>l.order_id[0]))]; if(ords.length<3){ out[pid]=[]; continue; }
        const g=await EYG.rpc("sale.order.line","read_group",[[["order_id","in",ords],["product_id","!=",pid]],["product_uom_qty:sum"],["product_id"]],{lazy:false,limit:400});
        out[pid]=(g||[]).filter(x=>x.product_id).map(x=>({id:x.product_id[0], n:x.__count, pedidos:ords.length})).sort((a,b)=>b.n-a.n).slice(0,8);
      }catch(e){ out[pid]=[]; }
    }
    return out;
  }

  /* ---------- 2. PROPUESTAS (liviano, en vivo con las ofertas de hoy) ---------- */
  // precio a proponer: descuento d sobre el publicado, nunca debajo de "piso"; éticos a % ENTERO del PVP
  function precioOferta(r, base, d, piso){
    const meta=base*(1-d);
    if(r.pvp>0 && r.pvp>=base){
      let D=Math.ceil((1-meta/r.pvp)*100-1e-9);
      let p=r2(r.pvp*(1-D/100));
      while(D>0 && p<piso-0.005){ D--; p=r2(r.pvp*(1-D/100)); }
      return {precio:p, dPvp:D};
    }
    return {precio:r2(Math.max(meta,piso)), dPvp:null};
  }

  async function proponer(ctx){
    const D=await datos(ctx.forzar);
    const rows=D.rows.map(r=>Object.assign({},r));   // copia: el agrupador cuelga datos
    if(window.EYGOpo && EYGOpo.agrupar) EYGOpo.agrupar(rows); else rows.forEach(r=>{ r.g={venta:r.ventaU,venta3:r.venta3,qty:r.qty,n:1,reciente:r.compraReciente}; r.esVig=true; });
    const enOf=ctx.enOferta||{tmpl:new Set(),pid:new Set()};
    const ign=new Set(ctx.ignora||[]);
    const props=[];
    const canal=ctx.canal||{};
    const pisoDe=ctx.pisoDe||(()=>0);
    for(const r of rows){
      if(!(r.qty>0) || !r.activo || !r.tmpl || /^TRI-/i.test(r.code) || ign.has(r.id)) continue;
      if(enOf.tmpl.has(r.tmpl) || enOf.pid.has(r.id)) continue;
      const base=r.tramos.length?r.tramos[0].p:0;
      if(!(base>0) || !(r.costo>0)) continue;            // sin precio o sin costo no se puede medir: no se adivina
      /* CAPITAL = unidades × COSTO DEL MOTOR (el mismo con que se arma el precio). La valuación contable
         del stock (stock.quant.value) NO se usa: en varios productos no cuadra (26/10/2026: Ranitidina
         Denver valuada a $3.720 la ampolla con costo $600). */
      r.val=Math.round(r.qty*r.costo); r.val6=Math.round((r.qty6||0)*r.costo);
      if(base<r.costo-0.005){
        // publica DEBAJO del costo y no está en oferta: no es una oferta para armar, es un precio a revisar
        props.push({ key:"x:"+r.tmpl, tipo:"revisar", r, base, precio:base, inst:/HOSPITAL|DESCARTABLE|EQUIPOS MEDICOS|ORTOPEDIA/i.test(r.categ),
          impacto:Math.round((r.costo-base)*r.qty), score:Math.round(Math.max(r.val*0.5,(r.costo-base)*r.qty)) });
        continue;
      }
      const g=r.g||{venta:r.ventaU,venta3:r.venta3,qty:r.qty};
      const mAvg=r.ventaU/12, gMeses=g.venta>0?g.qty/(g.venta/12):999;
      const m0=(base-r.costo)/base;
      const pisoCat=pisoDe(r.costo, r.catId);             // precio mínimo de la categoría (0 = sin regla)
      const pisoPct=pisoCat>0?(1-r.costo/pisoCat):0;
      const pisoSano=pisoCat>0?pisoCat:r.costo*1.10;      // sin regla: no bajar de costo + 10%
      const antig=diasDesde(r.inDate);
      const factorT=(mAvg>0 && r.tly>0)?(r.tly/3)/mAvg:null;
      // tendencia contra lo que vendía ANTES de estos 30 días (un producto nuevo no está "en tendencia": no tiene historia)
      const previo=Math.max(0,r.ventaU-r.v30), tend=previo>=12?r.v30/(previo/11):null;
      const epoca=epocaDe(r.name);
      const fresco=(g.reciente||r.compraReciente);
      /* INSTITUCIONAL (hospitalarios, descartables, equipos): las compras vienen por licitación y en
         tandas grandes. Un pico del año pasado en la misma época NO es temporada, y una suba de 30 días
         no es tendencia: son compras de una institución. Temporada, época y tendencia, sólo farmacia. */
      const cn=canal[r.tmpl]&&canal[r.tmpl].canal;
      const inst=cn==="inst" || /HOSPITAL|DESCARTABLE|EQUIPOS MEDICOS|ORTOPEDIA/i.test(r.categ);
      let tipo=null, d=0, piso=pisoSano, impacto=0, urg=1, vig=15;
      // 1) vence antes de que el grupo lo venda
      if(r.val6>0 && r.vMin!=null && r.vMin>=0 && gMeses>r.vMin){
        tipo="vence"; d=r.vMin<=1.5?0.35:r.vMin<=3?0.28:0.20; piso=r2(r.costo*1.03); urg=1.8;
        impacto=r.val6; vig=Math.max(7,Math.min(30,Math.floor(r.vMin*30.44)-10));
      }
      // 2) capital dormido (el GRUPO no vende o está clavado), sin stock fresco ni temporada
      else if(!fresco && !r.seasonal && !epoca && (g.venta===0 || (g.venta3===0 && gMeses>12) || gMeses>36)){
        tipo=g.venta===0?"muerto":"clavado"; d=0.22; piso=r2(r.costo*1.05); urg=1.4; impacto=r.val;
      }
      else if(!fresco && !r.seasonal && r.esVig===false && r.venta3===0 && r.qty>0 && gMeses<12){
        tipo="discontinuada"; d=0.20; piso=r2(r.costo*1.05); urg=1.3; impacto=r.val;
      }
      // 3) sobrestock: el excedente sobre 3 meses de venta del grupo
      else if(!fresco && !r.seasonal && gMeses>12){
        tipo="sobre"; d=0.12; urg=1.1;
        const exc=Math.max(0,g.qty-Math.round(g.venta/12*3)); impacto=Math.round(r.val*(g.qty>0?exc/g.qty:0));
      }
      // 4) entra en temporada (medida con lo vendido el año pasado) y hay stock para atenderla
      /* TEMPORADA: el producto tiene que ser ESTACIONAL POR NATURALEZA (época del año en Argentina) y lo
         que vendió el año pasado en estos meses lo confirma (≥1,2× su promedio). Con un solo año de
         historia, un pico suelto puede ser casualidad (una compra grande): sin la época no es temporada. */
      else if(!inst && epoca && factorT!=null && factorT>=1.2 && r.tly>=6 && r.qty>=Math.max(3,r.tly*0.3) && m0-pisoPct>=0.07){
        tipo="temporada"; d=Math.min(0.10, Math.max(0.05,(m0-pisoPct)*0.5)); urg=1.25; vig=30;
        impacto=Math.min(r.qty,r.tly)*base*Math.max(0,m0-d);
      }
      // 5) época del año (sin historia propia) con demanda y margen
      else if(!inst && epoca && r.cli90>=2 && m0-pisoPct>=0.08 && r.qty>=6){
        tipo="epoca"; d=0.07; urg=1.05; vig=30; impacto=Math.min(r.qty, Math.max(r.v30,mAvg)*3)*base*Math.max(0,m0-d);
      }
      // 6) lo que se está vendiendo: sube fuerte y lo compran muchos → gancho
      else if(!inst && tend!=null && tend>=1.6 && r.v30>=6 && r.cli90>=8 && r.qty>=r.v30*1.5 && m0-pisoPct>=0.10){
        tipo="tendencia"; d=Math.min(0.08,(m0-pisoPct)*0.5); urg=1; impacto=r.v30*base*Math.max(0,m0-d);
      }
      // 7) bajó el costo: se puede trasladar parte al precio y vender más
      else if(r.xop && !r.xarch && r.costoAnt>r.costo && m0-pisoPct>=0.06){
        tipo="costo"; const ahorro=(r.costoAnt-r.costo)/base; d=Math.min(0.15,Math.max(0.05,ahorro*0.6)); urg=1.1;
        impacto=(r.costoAnt-r.costo)*r.qty;
      }
      if(!tipo) continue;
      const {precio,dPvp}=precioOferta(r, base, d, piso);
      const dEf=1-precio/base;
      if(dEf<0.05) continue;                               // menos de 5% no es una oferta
      const mN=(precio-r.costo)/precio;
      const perfora=pisoCat>0 && precio<pisoCat-0.005;
      const score=Math.round(impacto*urg*(1+Math.log10(1+r.cli90)*0.15));
      props.push({ key:"p:"+r.tmpl, tipo, r, base, inst, precio, dPvp, dEf, m0, mN, pisoCat, pisoPct, perfora, gMeses, mAvg, antig, factorT, tend, epoca, vig,
        canal:cn||"", impacto:Math.round(impacto), score });
    }
    // combos: para los 6 más quietos, el compañero que más se compra con ellos y tiene stock y rotación
    const quietos=props.filter(p=>!p.inst && ["muerto","clavado","sobre","discontinuada"].includes(p.tipo)).sort((a,b)=>b.score-a.score).slice(0,6);
    if(quietos.length && !ctx.sinCombos){
      const byId={}; rows.forEach(r=>byId[r.id]=r);
      const comp=await EYG.cacheOdoo("asesor-comb-"+VERSION+"-"+EYG.argToday()+"-"+quietos.map(q=>q.r.id).join("."), CACHE_TTL, ()=>companeros(quietos.map(q=>q.r.id))).catch(()=>({}));
      for(const q of quietos){
        const c=(comp[q.r.id]||[]).map(x=>({...x, r:byId[x.id]})).find(x=>x.r && x.r.qty>0 && x.r.activo && x.r.ventaU>=24 && x.r.tramos.length && x.r.costo>0
          && (q.r.g&&x.r.g?q.r.g!==x.r.g:true) && !enOf.tmpl.has(x.r.tmpl) && x.n>=4 && x.n/x.pedidos>=0.3 && !/HOSPITAL|DESCARTABLE|EQUIPOS MEDICOS|ORTOPEDIA/i.test(x.r.categ));
        if(!c) continue;
        const b2=c.r.tramos[0].p, p2=precioOferta(c.r, b2, 0.05, pisoDe(c.r.costo,c.r.catId)||c.r.costo*1.10).precio;
        const total=r2(q.precio+p2), antes=r2(q.base+b2), costoT=q.r.costo+c.r.costo;
        props.push({ key:"c:"+q.r.tmpl+"+"+c.r.tmpl, tipo:"combo", r:q.r, r2:c.r, base:antes, precio:total, dEf:1-total/antes,
          mN:(total-costoT)/total, m0:(antes-costoT)/antes, p1:q.precio, p2, n:c.n, pedidos:c.pedidos,
          canal:(canal[q.r.tmpl]&&canal[q.r.tmpl].canal)||"", impacto:q.impacto, score:Math.round(q.score*0.9), vig:21 });
      }
    }
    // mejoras de las ofertas que ya están publicadas
    for(const o of (ctx.ofertas||[])) {
      const m=mejora(o, rows, pisoDe); if(m) props.push(m);
    }
    props.sort((a,b)=>b.score-a.score);
    const fam={}, fil=[];
    const famDe=n=>String(n||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\[[^\]]*\]/g," ").replace(/[^A-Z0-9 ]+/g," ").trim().split(/\s+/).slice(0,4).join(" ");
    for(const p of props){ const k=p.tipo.startsWith("m-")?p.key:famDe(p.r&&p.r.name); fam[k]=(fam[k]||0)+1; if(fam[k]<=2) fil.push(p); }
    props.length=0; props.push(...fil);
    return { fecha:D.fecha, revisados:D.rows.filter(r=>r.qty>0).length, props:props.slice(0,ctx.max||30) };
  }

  /* o = {key, id, titulo, tmpl, precio, costo, perforar, stock, hasta, placa, pedidos, clientes, dias, facturado, kind} */
  function mejora(o, rows, pisoDe){
    if(!o || !(o.stock>0)) return null;
    const hoy=EYG.argToday();
    const r=rows.find(x=>x.tmpl===o.tmpl)||null;
    const catId=r?r.catId:0, pisoCat=o.costo>0?pisoDe(o.costo,catId):0;
    const diasFin=o.hasta?Math.round((new Date(o.hasta)-new Date(hoy))/864e5):null;
    const valStock=(o.costo||0)*(o.stock||0);
    if(o.costo>0 && o.precio>0 && o.precio<o.costo-0.005 && !o.perforar){
      const minimo=pisoCat>0?pisoCat:o.costo*1.05;
      const nuevo=r&&r.pvp>0?precioOferta(r, minimo, 0, minimo).precio:r2(minimo);   // éticos: % entero del PVP
      return {key:"m:costo:"+o.key, tipo:"m-costo", o, r, precio:nuevo, base:o.precio, mN:(nuevo-o.costo)/nuevo, m0:(o.precio-o.costo)/o.precio, score:Math.round(valStock*1.5), impacto:Math.round((o.costo-o.precio)*o.stock)};
    }
    // sin ventas: pero si el producto está ENTRANDO en su época (repelentes en primavera, etc.) no se pausa ni se rebaja
    if(o.dias>=10 && o.pedidos===0 && !epocaDe(o.titulo)){
      const piso=o.perforar?o.costo*1.03:(pisoCat>0?pisoCat:o.costo*1.10);
      const nuevo=r&&r.pvp>0?precioOferta(r, o.precio, 0.08, piso).precio:r2(Math.max(o.precio*0.92, piso));   // éticos: % entero del PVP
      // más descuento SÓLO si deja un margen sano (≥10% y ≥ piso): bajar casi al costo algo que no se vende no es la salida
      const pisoPctM=pisoCat>0?1-o.costo/pisoCat:0, mNuevo=o.costo>0?(nuevo-o.costo)/nuevo:0;
      if(nuevo<=o.precio-Math.max(1,o.precio*0.02) && mNuevo>=Math.max(0.10,pisoPctM)) return {key:"m:prof:"+o.key, tipo:"m-profundizar", o, r, precio:nuevo, base:o.precio, mN:o.costo>0?(nuevo-o.costo)/nuevo:null, m0:o.costo>0?(o.precio-o.costo)/o.precio:null, score:Math.round(valStock*0.8), impacto:Math.round(valStock)};
      return {key:"m:pausa:"+o.key, tipo:"m-pausar", o, r, precio:o.precio, base:o.precio, score:Math.round(valStock*0.4), impacto:Math.round(valStock)};
    }
    if(diasFin!=null && diasFin>=0 && diasFin<=5 && o.clientes>=3){
      return {key:"m:ext:"+o.key, tipo:"m-extender", o, r, precio:o.precio, base:o.precio, score:Math.round((o.facturado||0)*0.8), impacto:Math.round(o.facturado||0)};
    }
    if(!o.placa && o.clientes>=1){
      return {key:"m:placa:"+o.key, tipo:"m-placa", o, r, precio:o.precio, base:o.precio, score:Math.round((o.facturado||0)*0.15), impacto:Math.round(o.facturado||0)};
    }
    return null;
  }

  window.EYGAsesor={ datos, proponer, precioOferta, epocaDe, VERSION };
})();
