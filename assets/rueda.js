/* ============================================================================
   PLAN RUEDA · EyG Core — el cálculo (window.EYGRueda).
   La estrategia que arrancó el 16/11/2026: que el stock gire y vuelva como plata DE CONTADO.
   Palancas: Superofertas de contado (liquidar sobrestock a margen chico, cobrado antes de
   preparar), freno de compras y bajar el stock valorizado hacia la meta (de ~$450M a ~$200M).

   Este archivo SOLO LEE Odoo (rpc) y arma un objeto con los datos crudos ya ordenados; la pantalla
   (direccion/rueda.html) hace las sumas por período. Corre igual en el navegador (EYG.rpc) y en
   Node (vm + rpc.js) para comprobar los números fuera de la pantalla.

   DEFINICIONES (las mismas que en el resto del Core):
   · Inicio del plan (T0) = `activadaEn` de eyg.ofertas_contado. Un producto sumado después
     (`agregados[].at`) cuenta desde su propio alta.
   · Venta de superoferta = renglón de un pedido con etiqueta de superoferta (eyg.ofertas_contado_tags:
     ESPERANDO PAGO / PAGADO / EFECTIVO / PAGO INFORMADO / DIFERENCIA) confirmado (sale/done).
     Los presupuestos (draft/sent) se muestran aparte: todavía no son venta.
   · Margen = el de Odoo en el renglón (neto sin IVA − costo del renglón, `margin`).
   · Comisión de la comercial = neto × tasa BASE de su perfil (eyg.comisiones, la del mes) × el
     multiplicador de nivel del ÚLTIMO MES LIQUIDADO (eyg.comisiones_cierre_*). Sólo cobran comisión
     las que entran en la liquidación; Gerencia, cuentas genéricas y líderes no.
   · Comisión de Mercado Pago = los asientos "Comisión Mercado Pago · <pedido>" que deja la acción 1336.
   · Canal: portal (website_id) / WhatsApp (origin) / Core (origin "Core" o lo cargó el conector) /
     Odoo a mano (el resto) — misma regla que Métricas.
   · Stock valorizado por día = stock de HOY (stock.quant, depósitos internos) menos los movimientos
     hechos después de ese día, todo al COSTO DE HOY de cada producto. Así la curva mide unidades que
     salen/entran, no cambios de costo.
   · Días de cobro (antes) = promedio ponderado por monto entre la fecha de la factura y la fecha de
     la imputación del cobro, de las imputaciones hechas en los 90 días previos al plan.
   ========================================================================== */
(function(){
  const AR_OFF = 3*3600*1000;                 // Argentina = UTC−3 (sin horario de verano)
  const TZ = {tz:"America/Argentina/Buenos_Aires", lang:"es_AR"};
  const r2 = x => Math.round((+x||0)*100)/100;
  /* "2026-11-16 21:41:39" (UTC de Odoo) o ISO → Date */
  const dUTC = s => s ? new Date(String(s).includes("T") ? s : String(s).replace(" ","T")+"Z") : null;
  /* día argentino "YYYY-MM-DD" de un instante */
  const diaAR = s => { const d = (s instanceof Date) ? s : dUTC(s); return d ? new Date(d.getTime()-AR_OFF).toISOString().slice(0,10) : null; };
  const odooUTC = d => d.toISOString().slice(0,19).replace("T"," ");
  const addDias = (iso,n) => { const d=new Date(iso+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
  const id0 = v => Array.isArray(v) ? v[0] : (v||null);
  const nm = v => Array.isArray(v) ? v[1] : "";
  /* día de un grupo de read_group (viene "17 nov. 2026"; el rango trae la fecha de verdad) */
  const diaGrupo = (g, campo) => { const r=g.__range && g.__range[campo]; if(r && r.from) return String(r.from).slice(0,10);
    const dm=(g.__domain||[]).find(x=>Array.isArray(x)&&x[1]===">="&&/^\d{4}-\d\d-\d\d/.test(x[2])); return dm?String(dm[2]).slice(0,10):null; };
  const chunk = (a,n) => { const o=[]; for(let i=0;i<a.length;i+=n) o.push(a.slice(i,i+n)); return o; };

  function canalDe(o){
    if(o.website_id) return "portal";
    const og = String(o.origin||"");
    if(/whatsapp/i.test(og)) return "whatsapp";
    if(/core/i.test(og) || (!og && id0(o.create_uid)===520 && id0(o.user_id)!==520)) return "core";
    return "odoo";
  }
  const CANALES = {portal:"Portal web", core:"Core (comerciales)", whatsapp:"WhatsApp", odoo:"Odoo a mano"};

  async function cargar(rpc, opts){
    opts = opts||{};
    const DIAS_ANTES = opts.diasAntes || 90;     // historia que se trae para comparar
    const progreso = opts.progreso || (()=>{});
    const ahora = opts.ahora ? new Date(opts.ahora) : new Date();
    const hoy = diaAR(ahora);

    progreso("Leyendo la configuración del plan…");
    const gp = k => rpc("ir.config_parameter","get_param",[k]);
    const [rawOf, rawComi, rawTags, rawCierres] = await Promise.all([gp("eyg.ofertas_contado"), gp("eyg.comisiones"), gp("eyg.ofertas_contado_tags"), gp("eyg.comisiones_cierres")]);
    const OF = JSON.parse(rawOf||"{}");
    if(!OF.items || !OF.items.length || !OF.activadaEn) throw new Error("La oferta de contado no está activada: no hay plan que medir.");
    const COMI = JSON.parse(rawComi||"{}");
    const T = String(rawTags||"").split(",").map(x=>parseInt(x,10)||0);
    const TAG = {esp:T[0]||0, pag:T[1]||0, efe:T[2]||0, inf:T[3]||0, dif:T[4]||0};
    const TAGS = T.filter(Boolean);
    let cierres=[]; try{ cierres = JSON.parse(rawCierres||"[]"); }catch(e){}
    const ultCierre = (cierres||[]).slice().sort().pop()||null;
    let CIERRE = null;
    if(ultCierre){ try{ CIERRE = JSON.parse(await gp("eyg.comisiones_cierre_"+ultCierre)||"null"); }catch(e){} }

    let DIN=null; try{ DIN=JSON.parse(await gp("eyg.ofertas_contado_dinamico")||"null"); }catch(e){}
    let SYNC=[]; try{ const x=JSON.parse(await gp("eyg.sync_ofertas")||"[]"); SYNC=Array.isArray(x)?x:Object.values(x); }catch(e){}
    const T0 = dUTC(OF.activadaEn);
    const dia0 = diaAR(T0);
    const desde = addDias(dia0, -DIAS_ANTES);
    const desdeUTC = odooUTC(new Date(new Date(desde+"T00:00:00Z").getTime()+AR_OFF));
    const altaDe = {}; for(const a of (OF.agregados||[])) altaDe[a.tmpl] = a.at;
    const items = OF.items.map(i=>({ ...i, alta: altaDe[i.tmpl] || OF.activadaEn, diaAlta: diaAR(altaDe[i.tmpl] || OF.activadaEn) }));
    const CAMB = (OF.cambios||[]).slice().sort((a,b)=>String(a.at)<String(b.at)?-1:1);
    /* precio que tenía la oferta en un instante: el del último cambio anterior; antes del primero, su "antes" */
    function precioEn(it, cuando){
      const t = dUTC(cuando)||new Date(); const cs = CAMB.filter(c=>c.tmpl===it.tmpl);
      let pr = null; for(const c of cs){ if(dUTC(c.at) <= t) pr = +c.precio; }
      if(pr==null){ const prim = cs.find(c=>c.antes!=null); pr = prim ? +prim.antes : +it.precio; }
      return pr||0;
    }
    /* la regla estuvo pausada hasta que la acción dinámica la reactivó ("estaba pausada" en el registro) */
    function estabaPausada(it, cuando){
      const t = dUTC(cuando); if(!t) return false;
      const c = CAMB.find(c=>c.tmpl===it.tmpl && c.auto && /estaba pausada/.test(c.motivo||"") && dUTC(c.at) > t);
      return !!c && t >= dUTC(OF.activadaEn);
    }
    const pids = items.map(i=>i.pid);
    const PIT = await rpc("product.pricelist.item","search_read",[[["pricelist_id","=",3],["product_tmpl_id","in",items.map(i=>i.tmpl)]]],{fields:["product_tmpl_id","fixed_price","min_quantity"]});
    const PVPS = {}; for(const t of await rpc("product.template","read",[items.map(i=>i.tmpl),["list_price"]])) PVPS[t.id]=+t.list_price||0;
    for(const it of items){
      const regla = SYNC.find(x=>x&&x.id==="ct"+it.tmpl)||null;
      const esc = PIT.filter(p=>id0(p.product_tmpl_id)===it.tmpl).sort((a,b)=>a.min_quantity-b.min_quantity).map(p=>[p.min_quantity,+p.fixed_price||0]);
      it.odoo = { pausada: !!(regla&&regla.pausada), pausaPvp: regla&&regla.pausa_pvp||null, sinRegla: !regla, escalera: esc, pvpHoy: PVPS[it.tmpl]||null,
        ok: esc.length===1 && Math.abs(esc[0][1]-(+it.precio||0))<0.011 && !(regla&&regla.pausada) };
    }
    const PID = {}; items.forEach(i=>PID[i.pid]=i);

    /* ---------- comisión por comercial (última liquidación) ---------- */
    const mesHoy = hoy.slice(0,7);
    const tasas = (()=>{ const h=(COMI.ratesHist||[]).filter(e=>e&&e.rates&&String(e.desde)<=mesHoy).sort((a,b)=>String(a.desde)<String(b.desde)?-1:1);
      return (h.length ? h[h.length-1].rates : COMI.rates) || {inst:{base:.02},farm:{base:.023},externo:{base:.03}}; })();
    const COMERCIAL = {};   // uid → {nombre, perfil, tasa, mult}
    for(const c of ((CIERRE&&CIERRE.comerciales)||[])){
      if((COMI.bajas||{})[String(c.uid)] && String(mesHoy) >= String(COMI.bajas[String(c.uid)])) continue;
      const perfil = (COMI.rubros||{})[String(c.uid)] || c.perfil || "farm";
      COMERCIAL[c.uid] = { nombre:c.nombre, perfil, tasa:(tasas[perfil]||{}).base||0, mult: (c.nivel&&c.nivel.mult) || 1, nivel: c.nivel ? (c.nivel.emoji+" "+c.nivel.nombre) : "sin nivel" };
    }

    /* ---------- renglones de los productos del plan (antes y después) ---------- */
    progreso("Trayendo las ventas de los productos de la oferta…");
    const L = await rpc("sale.order.line","search_read",[[["product_id","in",pids],["state","in",["sale","done","sent","draft"]],["order_id.date_order",">=",desdeUTC]]],
      {fields:["product_id","product_uom_qty","qty_delivered","price_subtotal","price_total","price_unit","discount","purchase_price","margin","order_id","order_partner_id","salesman_id","state","create_date"],limit:50000});
    const orderIds = [...new Set(L.map(l=>id0(l.order_id)))];
    /* pedidos con etiqueta de superoferta desde el inicio (por si alguno no tiene renglón de los 36: se avisa) */
    const tagOrders = TAGS.length ? await rpc("sale.order","search",[[["tag_ids","in",TAGS],["date_order",">=",odooUTC(new Date(T0.getTime()-2*864e5))]]]) : [];
    const allOrd = [...new Set([...orderIds, ...tagOrders])];
    const ORD = {};
    for(const ch of chunk(allOrd, 300)){
      const rs = await rpc("sale.order","read",[ch,["name","date_order","state","pricelist_id","website_id","origin","create_uid","user_id","tag_ids","amount_untaxed","amount_total","margin","partner_id","invoice_status","create_date"]],{context:TZ});
      for(const o of rs) ORD[o.id] = o;
    }
    const estadoPago = o => { const t=o.tag_ids||[];
      if(TAG.dif && t.includes(TAG.dif)) return "diferencia";
      if(TAG.efe && t.includes(TAG.efe)) return t.includes(TAG.pag) ? "efectivo_cobrado" : "efectivo";
      if(TAG.pag && t.includes(TAG.pag)) return "pagado";
      if(TAG.inf && t.includes(TAG.inf)) return "informado";
      if(TAG.esp && t.includes(TAG.esp)) return "esperando";
      return null; };
    const esSuper = o => !!o && (o.tag_ids||[]).some(t=>TAGS.includes(t));

    const lineas = L.map(l=>{
      const o = ORD[id0(l.order_id)] || {};
      const it = PID[id0(l.product_id)];
      const uid = id0(o.user_id);
      const com = COMERCIAL[uid];
      const qty = +l.product_uom_qty||0, neto = +l.price_subtotal||0, margenOdoo = +l.margin||0;
      const costoOdoo = r2(neto-margenOdoo), sup = esSuper(o);
      /* COSTO DEL PRODUCTO para una superoferta = el del plan, que es sobre el que se fija el 10% (Diego, 17/11:
         "el 10% es solo sobre el costo del producto, el resto le va comiendo"): el mayor entre el costo del motor y
         la última factura, y lo mantiene al día la acción "Superofertas: precio dinámico". La comisión de la
         comercial y la de Mercado Pago salen DE ESE margen. El costo con que Odoo valuó la salida (purchase_price)
         queda sólo como referencia: puede venir de la orden de compra y no de la factura (alcohol en gel: OC
         1.056,25 contra factura 982,31 neto). */
      const costoPlan = it ? r2((+it.costo||0)*qty) : costoOdoo;
      const costo = sup && it ? costoPlan : costoOdoo;
      const margen = r2(neto - costo);
      /* ¿se cobró al precio de la oferta? neto por unidad contra el precio anunciado (sin IVA) */
      const unit = qty ? neto/qty : 0;
      const desvio = sup && it && qty ? r2(neto - precioEn(it, l.create_date)*qty) : 0;
      return {
        id:l.id, pid:id0(l.product_id), tmpl:it?it.tmpl:null, order:id0(l.order_id), pedido:o.name||nm(l.order_id),
        estado:o.state||l.state, confirmado: ["sale","done"].includes(o.state||l.state),
        fecha:o.date_order, dia:diaAR(o.date_order), lista:id0(o.pricelist_id), farmacia:id0(o.pricelist_id)===3,
        canal:canalDe(o), partner:id0(o.partner_id)||id0(l.order_partner_id), cliente:nm(o.partner_id)||nm(l.order_partner_id),
        uid, vendedor:nm(o.user_id), super:sup, pago:estadoPago(o),
        qty, entregado:+l.qty_delivered||0, neto, total:+l.price_total||0, costo, margen, costoOdoo, margenOdoo, costoPlan,
        unit, precioOferta: it ? precioEn(it, l.create_date) : null,
        desvio: Math.abs(desvio) >= Math.max(0.02*qty, 0.5) ? desvio : 0,
        /* por qué no coincide: el renglón se cargó antes de que el producto entrara en la oferta, o venía de un
           presupuesto armado antes del arranque (al separar el pedido se copió el precio viejo) */
        causa: !(sup && it) ? null : estabaPausada(it, l.create_date) ? "la oferta estaba pausada por un cambio de PVP (se cobró el precio normal)" : (dUTC(l.create_date) < dUTC(it.alta) ? (dUTC(o.create_date) < T0 ? "presupuesto anterior al arranque" : "cargado antes de que el producto entrara en la oferta") : (/aparte de/i.test(String(o.origin||"")) ? "se separó de un presupuesto y quedó con el precio viejo" : "precio distinto al de la oferta")),
        precio:+l.price_unit||0, desc:+l.discount||0,
        comision: com ? r2(neto*com.tasa) : 0, comisionNivel: com ? r2(neto*com.tasa*com.mult) : 0,
        despuesAlta: it ? (dUTC(o.date_order) >= dUTC(it.alta)) : false,
      };
    });

    /* ---------- cobros de las superofertas ---------- */
    progreso("Leyendo los cobros de las superofertas…");
    const desdeCobro = diaAR(new Date(T0.getTime()-2*864e5));
    const [PAY, FEE] = await Promise.all([
      rpc("account.payment","search_read",[[["ref","=like","Superoferta %"],["state","=","posted"],["date",">=",desdeCobro]]],{fields:["name","ref","date","create_date","amount","journal_id","payment_reference"],limit:2000}),
      rpc("account.move","search_read",[[["ref","=like","Comisión Mercado Pago · %"],["state","=","posted"],["date",">=",desdeCobro]]],{fields:["ref","amount_total","date"],limit:2000}),
    ]);
    const cobros = {};   // nombre de pedido → {recibos, monto, cuando, diario, mp, comisionMP}
    for(const p of PAY){ const so=String(p.ref||"").replace(/^Superoferta\s+/,"").trim(); const c=cobros[so]||(cobros[so]={recibos:[],monto:0,cuando:null,diario:"",mp:false,comisionMP:0});
      c.recibos.push(p.name); c.monto=r2(c.monto+(+p.amount||0)); c.diario=nm(p.journal_id); if(/^MP\s/.test(p.payment_reference||"")) c.mp=true;
      if(!c.cuando || p.create_date < c.cuando) c.cuando=p.create_date; }
    for(const f of FEE){ const m=/·\s*(\S+)\s*·/.exec(f.ref||""); if(!m) continue; const c=cobros[m[1]]||(cobros[m[1]]={recibos:[],monto:0,cuando:null,diario:"",mp:true,comisionMP:0}); c.comisionMP=r2(c.comisionMP+(+f.amount_total||0)); }

    /* pedidos de superoferta (cabecera) */
    const pedidos = Object.values(ORD).filter(o=>esSuper(o) && dUTC(o.date_order) >= new Date(T0.getTime()-2*864e5)).map(o=>{
      const ls = lineas.filter(l=>l.order===o.id);
      const c = cobros[o.name]||null;
      const uid=id0(o.user_id), com=COMERCIAL[uid];
      return { id:o.id, name:o.name, fecha:o.date_order, creado:o.create_date, dia:diaAR(o.date_order), estado:o.state, confirmado:["sale","done"].includes(o.state),
        canal:canalDe(o), partner:id0(o.partner_id), cliente:nm(o.partner_id), uid, vendedor:nm(o.user_id), comercial:com||null,
        pago:estadoPago(o), neto:+o.amount_untaxed||0, total:+o.amount_total||0,
        margen: ls.length ? r2(ls.reduce((a,l)=>a+l.margen,0) + ((+o.margin||0) - ls.reduce((a,l)=>a+l.margenOdoo,0))) : +o.margin||0,
        desvio: r2(ls.reduce((a,l)=>a+l.desvio,0)),
        comision: com?r2((+o.amount_untaxed||0)*com.tasa):0, comisionNivel: com?r2((+o.amount_untaxed||0)*com.tasa*com.mult):0,
        cobro:c, horasAlCobro: c&&c.cuando ? Math.max(0,(dUTC(c.cuando)-dUTC(o.create_date||o.date_order))/36e5) : null,
        renglones: ls.length, unidades: ls.reduce((a,l)=>a+l.qty,0) };
    }).sort((a,b)=>a.fecha<b.fecha?1:-1);

    /* ---------- stock: hoy y reconstruido día por día ---------- */
    progreso("Reconstruyendo el stock día por día…");
    const domIn  = [["state","=","done"],["date",">=",desdeUTC],["location_dest_id.usage","=","internal"],["location_id.usage","!=","internal"]];
    const domOut = [["state","=","done"],["date",">=",desdeUTC],["location_id.usage","=","internal"],["location_dest_id.usage","!=","internal"]];
    const [Q, MIN, MOUT, MV36] = await Promise.all([
      rpc("stock.quant","read_group",[[["location_id.usage","=","internal"]],["value:sum","quantity:sum"],["product_id"]],{lazy:false,limit:20000}),
      rpc("stock.move","read_group",[domIn,["product_qty:sum"],["product_id","date:day"]],{lazy:false,limit:100000,context:TZ}),
      rpc("stock.move","read_group",[domOut,["product_qty:sum"],["product_id","date:day"]],{lazy:false,limit:100000,context:TZ}),
      rpc("stock.move","search_read",[[["state","=","done"],["product_id","in",pids],["date",">=",odooUTC(new Date(T0.getTime()-2*864e5))],"|",["location_id.usage","=","internal"],["location_dest_id.usage","=","internal"]]],
        {fields:["product_id","date","product_qty","location_id","location_dest_id","picking_type_id","origin","reference"],limit:20000,context:TZ}),
    ]);
    const QQ={}, QV={};
    for(const q of Q){ const p=id0(q.product_id); if(!p) continue; QQ[p]=+q.quantity||0; QV[p]=+q.value||0; }
    // costo unitario de hoy: valor/cantidad del quant; si no hay stock, el costo del producto
    const movPids = [...new Set([...MIN,...MOUT].map(g=>id0(g.product_id)).filter(Boolean))];
    const sinCosto = movPids.filter(p=>!(QQ[p]>0 && QV[p]>0));
    const CU = {};
    for(const p in QQ) if(QQ[p]>0 && QV[p]>0) CU[p]=QV[p]/QQ[p];
    for(const ch of chunk(sinCosto, 400)){
      const rs = await rpc("product.product","read",[ch,["standard_price"]],{context:{active_test:false}});
      for(const r of rs) CU[r.id] = +r.standard_price||0;
    }
    // neto de movimientos por día (entra − sale) por producto
    const NET = {};   // dia → {pid: qty}
    for(const g of MIN){ const p=id0(g.product_id), d=diaGrupo(g,"date:day"); if(!p||!d) continue; (NET[d]=NET[d]||{})[p]=((NET[d]||{})[p]||0)+(+g.product_qty||0); }
    for(const g of MOUT){ const p=id0(g.product_id), d=diaGrupo(g,"date:day"); if(!p||!d) continue; (NET[d]=NET[d]||{})[p]=((NET[d]||{})[p]||0)-(+g.product_qty||0); }
    const ENT={}, SAL={};   // valor a costo de hoy de lo que entró / salió cada día
    for(const g of MIN){ const p=id0(g.product_id), d=diaGrupo(g,"date:day"); if(!p||!d) continue; ENT[d]=(ENT[d]||0)+(+g.product_qty||0)*(CU[p]||0); }
    for(const g of MOUT){ const p=id0(g.product_id), d=diaGrupo(g,"date:day"); if(!p||!d) continue; SAL[d]=(SAL[d]||0)+(+g.product_qty||0)*(CU[p]||0); }
    // valor de hoy (sólo cantidades positivas, igual que el análisis del 16/11)
    const valorHoy = Object.keys(QQ).reduce((a,p)=>a+(QQ[p]>0&&QV[p]>0?QV[p]:0),0);
    const dias=[]; for(let d=desde; d<=hoy; d=addDias(d,1)) dias.push(d);
    // stock al CIERRE de cada día: hacia atrás desde hoy
    const qtyCierre = {...QQ};
    const valorCierre = {};
    const valorDe = q => Object.keys(q).reduce((a,p)=>a+(q[p]>0?q[p]*(CU[p]||0):0),0);
    for(let i=dias.length-1;i>=0;i--){
      const d=dias[i];
      valorCierre[d] = valorDe(qtyCierre);
      const n = NET[d]||{}; for(const p in n) qtyCierre[p]=(qtyCierre[p]||0)-n[p];   // deshace el día → queda el cierre del anterior
    }
    const stockSerie = dias.map(d=>({dia:d, valor:r2(valorCierre[d]), entra:r2(ENT[d]||0), sale:r2(SAL[d]||0)}));

    // stock de cada producto del plan: hoy, al momento de su alta y lo que se movió desde entonces
    const prod36 = {};
    for(const it of items) prod36[it.pid] = { hoy: QQ[it.pid]||0, valorHoy: QV[it.pid]||0, costoHoy: CU[it.pid]||it.costo||0, entra:0, sale:0 };
    // ubicaciones internas de los movimientos de los 36
    const locIds = [...new Set(MV36.flatMap(m=>[id0(m.location_id),id0(m.location_dest_id)]).filter(Boolean))];
    const LOCINT = {};
    if(locIds.length){ const ls = await rpc("stock.location","read",[locIds,["usage"]]); for(const l of ls) LOCINT[l.id] = l.usage==="internal"; }
    for(const it of items){
      const alta = dUTC(it.alta); let entra=0, sale=0;
      for(const m of MV36){ if(id0(m.product_id)!==it.pid || dUTC(m.date)<alta) continue;
        const fi=LOCINT[id0(m.location_id)], di=LOCINT[id0(m.location_dest_id)], q=+m.product_qty||0;
        if(di && !fi) entra+=q; else if(fi && !di) sale+=q; }
      const p = prod36[it.pid]; p.entra=entra; p.sale=sale; p.alAlta = p.hoy - entra + sale;
    }

    /* ---------- toda la droguería: ventas, compras y cobros por día ---------- */
    progreso("Comparando con el resto de la droguería…");
    const [VD, CD, PD] = await Promise.all([
      rpc("sale.order","read_group",[[["state","in",["sale","done"]],["date_order",">=",desdeUTC]],["amount_untaxed:sum","margin:sum"],["date_order:day","pricelist_id"]],{lazy:false,limit:20000,context:TZ}),
      rpc("purchase.order","read_group",[[["state","in",["purchase","done"]],["date_approve",">=",desdeUTC]],["amount_untaxed:sum"],["date_approve:day"]],{lazy:false,limit:5000,context:TZ}),
      rpc("account.payment","read_group",[[["state","=","posted"],["payment_type","=","inbound"],["partner_type","=","customer"],["is_internal_transfer","=",false],["date",">=",desde]],["amount:sum"],["date:day"]],{lazy:false,limit:5000}),
    ]);
    const dia = {}; for(const d of dias) dia[d] = {dia:d, ventaFarm:0, margenFarm:0, ventaOtros:0, margenOtros:0, pedidos:0, compras:0, cobros:0};
    for(const g of VD){ const d=diaGrupo(g,"date_order:day"); if(!dia[d]) continue; const f=id0(g.pricelist_id)===3;
      dia[d][f?"ventaFarm":"ventaOtros"] += +g.amount_untaxed||0; dia[d][f?"margenFarm":"margenOtros"] += +g.margin||0; dia[d].pedidos += g.__count||0; }
    for(const g of CD){ const d=diaGrupo(g,"date_approve:day"); if(dia[d]) dia[d].compras += +g.amount_untaxed||0; }
    for(const g of PD){ const d=diaGrupo(g,"date:day"); if(dia[d]) dia[d].cobros += +g.amount||0; }
    const serie = dias.map(d=>({...dia[d], stock:r2(valorCierre[d]), entraStock:r2(ENT[d]||0), saleStock:r2(SAL[d]||0)}));

    /* ---------- clientes que compraron superofertas: ¿nuevos, recuperados o de siempre? ---------- */
    progreso("Mirando a los clientes…");
    const cliIds = [...new Set(pedidos.filter(p=>p.confirmado).map(p=>p.partner))].filter(Boolean);
    const cliAntes = {};
    if(cliIds.length){
      const [ult, n90] = await Promise.all([
        rpc("sale.order","read_group",[[["partner_id","in",cliIds],["state","in",["sale","done"]],["date_order","<",odooUTC(T0)]],["date_order:max"],["partner_id"]],{lazy:false}),
        rpc("sale.order","read_group",[[["partner_id","in",cliIds],["state","in",["sale","done"]],["date_order","<",odooUTC(T0)],["date_order",">=",odooUTC(new Date(T0.getTime()-90*864e5))]],["amount_untaxed:sum"],["partner_id"]],{lazy:false}),
      ]);
      for(const g of ult){ const p=id0(g.partner_id); cliAntes[p] = {ultima:g.date_order, pedidos:g.__count, compra90:0}; }
      for(const g of n90){ const p=id0(g.partner_id); (cliAntes[p]=cliAntes[p]||{ultima:null,pedidos:0}).compra90 = +g.amount_untaxed||0; }
      /* lo que compraron FUERA de las superofertas desde el arranque: ¿la oferta les come la compra de siempre? */
      const post = await rpc("sale.order","read_group",[[["partner_id","in",cliIds],["state","in",["sale","done"]],["date_order",">=",odooUTC(T0)],["tag_ids","not in",TAGS]],["amount_untaxed:sum"],["partner_id"]],{lazy:false});
      for(const g of post){ const p=id0(g.partner_id); (cliAntes[p]=cliAntes[p]||{ultima:null,pedidos:0,compra90:0}).comunDespues = +g.amount_untaxed||0; }
    }
    const clientes = cliIds.map(p=>{ const a=cliAntes[p]||null; const ps=pedidos.filter(x=>x.partner===p&&x.confirmado);
      const diasSin = a&&a.ultima ? Math.floor((T0-dUTC(a.ultima))/864e5) : null;
      return { partner:p, cliente:ps[0]?ps[0].cliente:"", vendedor:ps[0]?ps[0].vendedor:"", pedidos:ps.length, neto:ps.reduce((s,x)=>s+x.neto,0), total:ps.reduce((s,x)=>s+x.total,0),
        tipo: !a||!a.ultima ? "nuevo" : (diasSin>60 ? "recuperado" : "habitual"), diasSinComprar:diasSin, compra90: a?(a.compra90||0):0, comunDespues: a?(a.comunDespues||0):0 }; });

    /* ---------- cuánto tardaban en pagar (90 días antes del plan) ---------- */
    progreso("Calculando a cuántos días pagaban antes…");
    const farmCli = await rpc("sale.order","read_group",[[["pricelist_id","=",3],["state","in",["sale","done"]],["date_order",">=",odooUTC(new Date(T0.getTime()-180*864e5))]],["amount_untaxed:sum"],["partner_id"]],{lazy:false,limit:5000});
    const farmIds = farmCli.map(g=>id0(g.partner_id)).filter(Boolean);
    const dsoDe = async (pids) => {
      if(!pids.length) return null;
      let parts=[];
      for(const ch of chunk(pids, 400)){
        parts = parts.concat(await rpc("account.partial.reconcile","search_read",[[["debit_move_id.move_id.move_type","=","out_invoice"],["debit_move_id.partner_id","in",ch],
          ["max_date",">=",diaAR(new Date(T0.getTime()-90*864e5))],["max_date","<",dia0]]],{fields:["amount","max_date","debit_move_id"],limit:20000}));
      }
      const lids = [...new Set(parts.map(p=>id0(p.debit_move_id)))];
      const LD = {};
      for(const ch of chunk(lids, 800)){ const rs=await rpc("account.move.line","read",[ch,["date"]]); for(const r of rs) LD[r.id]=r.date; }
      let s=0, w=0; const tramos={d0:0,d15:0,d30:0,d60:0,d90:0};
      for(const p of parts){ const d0=LD[id0(p.debit_move_id)]; if(!d0) continue; const dd=Math.max(0,(new Date(p.max_date)-new Date(d0))/864e5); const a=+p.amount||0;
        s+=dd*a; w+=a; tramos[dd<=7?"d0":dd<=15?"d15":dd<=30?"d30":dd<=60?"d60":"d90"]+=a; }
      return w>0 ? {dias:s/w, monto:w, imputaciones:parts.length, tramos} : null;
    };
    const [dsoFarm, dsoCli] = await Promise.all([dsoDe(farmIds), dsoDe(cliIds)]);

    progreso("Listo.");
    return {
      generado: ahora.toISOString(), hoy, dia0, T0: OF.activadaEn, desde, diasAntes: DIAS_ANTES,
      oferta: { nombre:OF.nombre, estado:OF.estado, hasta:OF.hasta||null, margenMin:OF.margenMin, items, cambios:OF.cambios||[] }, dinamico: DIN,
      tags: TAG, comerciales: COMERCIAL, tasas, ultCierre,
      lineas, pedidos, cobros, clientes, prod36, serie, stockSerie,
      stockHoy: r2(valorCierre[hoy]), stockQuants: r2(valorHoy), dsoFarm, dsoCli, CANALES, feriados: COMI.feriados||[],
    };
  }

  const api = { cargar, canalDe, diaAR, addDias, CANALES };
  if(typeof window!=="undefined") window.EYGRueda = api;
  if(typeof module!=="undefined" && module.exports) module.exports = api;
})();
