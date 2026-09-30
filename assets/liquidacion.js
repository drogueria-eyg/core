/* ===== LIQUIDACIÓN DE COMISIONES · EyG Core =====
   Arma el cierre COMPLETO de un mes (lo mismo que ve cada comercial en su panel: comisión base +
   nivel + salud) y lo CONGELA, porque el nivel y la salud se calculan en vivo y desaparecen cuando
   cambia el mes. Mientras el mes no está liquidado se recalcula solo; al liquidar queda fijo.

   Dónde vive el cierre: ir.config_parameter
     · eyg.comisiones_cierre_YYYY-MM  → el JSON del mes (todo el desglose, comercial por comercial)
     · eyg.comisiones_cierres         → índice con los meses ya liquidados

   Las fórmulas son las MISMAS de comercial/panel.html — si allá cambian, hay que cambiarlas acá.
   Ver [[eyg-comisiones-niveles]] y [[eyg-comisiones-cierre-mensual]] en la memoria del proyecto. */
(function(){
"use strict";
const GEN=452;                                   // cuenta genérica "Drogueria EyG"
const SALDOS_INI=[32,33];                        // diarios "Saldos Iniciales" y "Saldos Iniciales B": deuda migrada, sin venta detrás
const PERFIL={ inst:{valor:38,activ:12,nom:"Instituciones"}, farm:{valor:25,activ:25,nom:"Farmacias / Comercial"} };
const OF_PTS_ENV=8, OF_META_ENV=30, OF_PTS_VEN=17, OF_META_VEN=10;
const NUEVOS_PTS=20, CONST_PTS=5;   // las METAS ahora salen de la config (contactosDia, nuevosMeta)
const NIV=[{n:"Bronce",e:"🥉",m:1.00},{n:"Plata",e:"🥈",m:1.05},{n:"Oro",e:"🥇",m:1.10},{n:"Platino",e:"💎",m:1.15},{n:"Diamante",e:"👑",m:1.20}];
const REQ=["name","tel","email","street","zip","city","state","idtype","vat","fiscal"];
const PFIELDS=["id","name","street","city","zip","state_id","phone","mobile","email","vat","l10n_ar_afip_responsibility_type_id","l10n_latam_identification_type_id"];
const CIERRES_KEY="eyg.comisiones_cierres";
const cierreKey=mes=>"eyg.comisiones_cierre_"+mes;
const cl=(x,a,b)=>Math.max(a,Math.min(b,x));
const rpc=(m,me,a,k)=>EYG.rpc(m,me,a,k||{});

/* --- fechas del mes "YYYY-MM" --- */
function rango(mes){
  const [y,m]=mes.split("-").map(Number);
  const ult=new Date(y,m,0).getDate();
  const ini=mes+"-01", fin=mes+"-"+String(ult).padStart(2,"0");
  const fmt=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const menos=(dias)=>{ const d=new Date(y,m-1,ult); d.setDate(d.getDate()-dias); return fmt(d); };
  // Corte del VENCIDO: el último día del mes, o hoy si el mes todavía está corriendo (no se puede dar
  // por vencida una factura cuyo plazo aún no llegó). Fijarlo así hace que el número sea reproducible.
  const hoy=(EYG&&EYG.argToday)?EYG.argToday():new Date().toISOString().slice(0,10);
  const topeVenc=(hoy<fin)?hoy:fin;
  // CONSTANCIA: mide los contactos de UN día. Si ese día cae sábado o domingo nadie trabaja y las
  // seis quedarían en cero, así que se toma el último día HÁBIL. Ver la misma regla en panel.html.
  const corte=(hoy<fin)?hoy:fin;
  const dc=new Date(corte+"T12:00:00");
  while(dc.getDay()===0||dc.getDay()===6) dc.setDate(dc.getDate()-1);
  const diaConstancia=fmt(dc);
  // VENCIMIENTOS DE FIN DE SEMANA: los que caen sábado o domingo se pagan el lunes, así que hasta
  // que ese lunes pase no están vencidos. Son a lo sumo dos fechas (el finde que acabó de pasar).
  const enGracia=[];
  for(let i=1;i<=3;i++){
    const x=new Date(topeVenc+"T12:00:00"); x.setDate(x.getDate()-i);
    if(x.getDay()!==0 && x.getDay()!==6) continue;
    const lun=new Date(x); while(lun.getDay()!==1) lun.setDate(lun.getDate()+1);
    if(fmt(lun)>=topeVenc) enGracia.push(fmt(x));
  }
  // PISO DE FACTURACIÓN: qué parte del mes transcurrió en DÍAS HÁBILES (al cerrar el mes da 1).
  let habTot=0, habPas=0; const corteDia=(hoy<fin)?Number(hoy.slice(8,10)):ult;
  for(let i=1;i<=ult;i++){ const w=new Date(y,m-1,i).getDay(); if(w===0||w===6) continue; habTot++; if(i<=corteDia) habPas++; }
  const propHabil=habTot?habPas/habTot:1;
  return { ini, fin, finH:fin+" 23:59:59", d100:menos(100), d190:menos(190), dias:ult, topeVenc, diaConstancia, enGracia, propHabil };
}
const pctFicha=c=>{ const has={name:!!c.name,tel:!!(c.phone||c.mobile),email:!!c.email,street:!!c.street,zip:!!c.zip,city:!!c.city,
  state:!!(c.state_id&&c.state_id[0]),idtype:!!(c.l10n_latam_identification_type_id&&c.l10n_latam_identification_type_id[0]),
  vat:!!c.vat,fiscal:!!(c.l10n_ar_afip_responsibility_type_id&&c.l10n_ar_afip_responsibility_type_id[0])};
  return Math.round(REQ.filter(k=>has[k]).length/REQ.length*100); };

/* ===== EXCLUSIONES PUNTUALES (eyg.comisiones_excluidos) =====
   Facturas o notas de crédito que Dirección decidió NO computar para la comisión, con su motivo.
   No se toca nada en la contabilidad: se saca solo del cálculo, y queda el registro de por qué.
   Caso que lo motivó (1/9/2026): una NC que revertía una venta de mayo ya liquidada. */
const EXCL_KEY="eyg.comisiones_excluidos";
let _excl=null;
async function excluidos(force){
  if(_excl && !force) return _excl;
  try{ _excl=JSON.parse(await rpc("ir.config_parameter","get_param",[EXCL_KEY])||"[]")||[]; }catch(e){ _excl=[]; }
  return _excl;
}
const exclIds=lista=>(lista||[]).map(x=>x&&x.move).filter(Boolean);

/* ===== persistencia del cierre ===== */
async function cierresLeer(){ try{ return JSON.parse(await rpc("ir.config_parameter","get_param",[CIERRES_KEY])||"[]")||[]; }catch(e){ return []; } }
async function cierreLeer(mes){ try{ const s=await rpc("ir.config_parameter","get_param",[cierreKey(mes)]); return s?JSON.parse(s):null; }catch(e){ return null; } }
async function cierreGuardar(mes,data){
  await rpc("ir.config_parameter","set_param",[cierreKey(mes),JSON.stringify(data)]);
  const idx=await cierresLeer(); if(!idx.includes(mes)){ idx.push(mes); idx.sort(); await rpc("ir.config_parameter","set_param",[CIERRES_KEY,JSON.stringify(idx)]); }
  return data;
}
async function cierreReabrir(mes){
  const idx=(await cierresLeer()).filter(m=>m!==mes);
  await rpc("ir.config_parameter","set_param",[CIERRES_KEY,JSON.stringify(idx)]);
  return idx;   // el JSON del mes NO se borra: queda como respaldo de lo que se había liquidado
}

/* ===== facturado neto del mes, atribuido a quien generó el pedido =====
   Rama A: el pedido es suyo. Rama B: el pedido quedó bajo la genérica → dueño del cliente.
   Se devuelven separadas para poder AUDITAR el arrastre por traspaso de clientes. */
async function facturado(uid,r,exIds){
  const ex=(exIds&&exIds.length)?[["move_id","not in",exIds]]:[];
  const base=mt=>[["parent_state","=","posted"],["move_id.move_type","=",mt],["date",">=",r.ini],["date","<=",r.fin],...ex];
  // Regla ÚNICA de atribución: la de EYG.domVendedor (core.js). Para un comercial es sólo lo que
  // vendió él; los pedidos de la cuenta genérica NO se le reparten (van a Gerencia). La rama B —que
  // antes se los daba al dueño del cliente— se sacó: un traspaso de cartera no puede mover ventas.
  const A=mt=>[...base(mt),...EYG.domVendedor("sale_line_ids.order_id.", uid)];
  const B=mt=>[...base(mt),["id","=",0]];   // rama B desactivada: queda en 0 y se sigue informando
  const g=(dom)=>rpc("account.move.line","read_group",[dom,["price_subtotal:sum","price_total:sum"],[]],{lazy:false}).catch(()=>[]);
  // el neto DÍA POR DÍA, para saber qué semanas llegaron al mínimo de venta. Se agrupa por
  // "date:day" a propósito: agrupar por un campo fecha sin granularidad devuelve el MES.
  const gd=(dom)=>rpc("account.move.line","read_group",[dom,["price_subtotal:sum"],["date:day"]],{lazy:false}).catch(()=>[]);
  const [ai,ar,bi,br,di,dr]=await Promise.all([g(A("out_invoice")),g(A("out_refund")),g(B("out_invoice")),g(B("out_refund")),
    gd(A("out_invoice")),gd(A("out_refund"))]);
  const porDia={};
  const sumaDias=(rows,signo)=>(rows||[]).forEach(x=>{
    const rg=x.__range&&x.__range["date:day"]; const k=rg?String(rg.from).slice(0,10):null;
    if(k) porDia[k]=(porDia[k]||0)+signo*(x.price_subtotal||0);
  });
  sumaDias(di,1); sumaDias(dr,-1);
  const v=(x,f)=>((x[0]||{})[f])||0;
  return { porDia,
    facturas: v(ai,"price_subtotal")+v(bi,"price_subtotal"),
    nc:       v(ar,"price_subtotal")+v(br,"price_subtotal"),
    facturasIVA: v(ai,"price_total")+v(bi,"price_total"),
    ncIVA:       v(ar,"price_total")+v(br,"price_total"),
    ramaA: v(ai,"price_subtotal")-v(ar,"price_subtotal"),
    ramaB: v(bi,"price_subtotal")-v(br,"price_subtotal"),
  };
}

/* ===== los 6 ítems del nivel + los 3 de la salud, para un comercial y un mes ===== */
async function gamificacion(uid,r,ofertasMes,cfgN){
  const u=await rpc("res.users","read",[[uid]],{fields:["id","name","partner_id"]});
  const uPartner=u[0]&&u[0].partner_id&&u[0].partner_id[0];
  const cart=await rpc("res.partner","search_read",[[["user_id","=",uid],["type","=","contact"],["parent_id","=",false]]],{fields:PFIELDS,limit:0});
  const ids=cart.map(c=>c.id);
  const fichas=cart.length?cart.filter(c=>pctFicha(c)>=100).length/cart.length:0;
  const pay=(desde,hasta)=>rpc("account.payment","read_group",[[["partner_id","in",ids],["payment_type","=","inbound"],["state","=","posted"],["date",">=",desde],["date","<=",hasta]],["amount:sum"],[]],{lazy:false}).catch(()=>[]);
  // DEUDA POR QUIEN VENDIO (no por cartera): la factura impaga se le cuenta a quien generó el pedido.
  // Si el cliente cambia de manos, la deuda vieja no la hereda quien lo recibe. Los SALDOS INICIALES
  // (diarios 32 y 33, la deuda migrada con la que arrancó el sistema) quedan afuera: no son venta de nadie.
  // UNA sola consulta en lugar de dos: se traen los renglones abiertos con su vencimiento y acá se
  // arma el total, el vencido y los TRAMOS DE MORA. Menos viajes al conector y más información.
  const recvLineas=()=>rpc("account.move.line","search_read",[[["account_id.account_type","=","asset_receivable"],["parent_state","=","posted"],["full_reconcile_id","=",false],["amount_residual",">",0],["journal_id","not in",SALDOS_INI],...((r.enGracia||[]).length?[["date_maturity","not in",r.enGracia]]:[]),
    ...EYG.domVendedor("move_id.invoice_line_ids.sale_line_ids.order_id.", uid)]],
    {fields:["amount_residual","date_maturity"],limit:0}).catch(()=>[]);
  const [cobMes,cob100,ordHist,nuevosAltas,deuLin,waMsgs,ofEnv]=await Promise.all([
    pay(r.ini,r.fin), pay(r.d100,r.fin),
    rpc("sale.order","search_read",[[["user_id","=",uid],["state","in",["sale","done"]],["date_order",">=",r.d190],["date_order","<=",r.finH]]],{fields:["partner_id","date_order"],limit:0}).catch(()=>[]),
    rpc("res.partner","search_read",[[["user_id","=",uid],["type","=","contact"],["parent_id","=",false],["create_date",">=",r.ini],["create_date","<=",r.finH]]],{fields:["id","name","create_date"],limit:0}).catch(()=>[]),
    recvLineas(),
    ids.length?rpc("mail.message","search_read",[[["model","=","res.partner"],["res_id","in",ids],["date",">=",r.diaConstancia+" 00:00:00"],["date","<=",r.diaConstancia+" 23:59:59"],"|",["body","like","EyGWA"],["body","like","EyGCRM"]]],{fields:["res_id"],limit:0}).catch(()=>[]):[],
    uPartner?rpc("mail.message","search_read",[[["model","=","res.partner"],["res_id","=",uPartner],["date",">=",r.ini+" 00:00:00"],["date","<=",r.finH],["body","like","EyGOFENV"]]],{fields:["date"],limit:0}).catch(()=>[]):[],
  ]);
  // cobro
  const cobradoMes=((cobMes[0]||{}).amount)||0;
  const objetivoCobro=(((cob100[0]||{}).amount)||0)/3*1.1;
  // actividad
  const bk={};
  for(const o of ordHist){ const m=(o.date_order||"").slice(0,7); if(!m)continue; (bk[m]=bk[m]||{ped:0,cli:new Set()}); bk[m].ped++; if(o.partner_id)bk[m].cli.add(o.partner_id[0]); }
  const mes=r.ini.slice(0,7);
  /* LA VARA DE LA ACTIVIDAD. El promedio de 6 meses regalaba el ítem: en septiembre las cinco
     sacaron el 100% porque el negocio creció y el promedio quedó muy atrás (Ruth hizo 117 pedidos
     contra un promedio de 56). Desde el paquete de octubre la vara es el MEJOR de los 3 meses
     previos: igualar su propio récord reciente. */
  const prev=Object.keys(bk).filter(m=>m<mes), nP=prev.length||1;
  const _vara=(EYG.paqueteRige(mes,cfgN)&&((cfgN&&cfgN.actividadVara)||"mejor3"))||"prom";
  let promPed, promCli;
  if(_vara==="mejor3"||_vara==="prom3"){
    const tres=[]; { let [y,m]=mes.split("-").map(Number);
      for(let i=0;i<3;i++){ m--; if(m<1){m=12;y--;} tres.unshift(y+"-"+String(m).padStart(2,"0")); } }
    const hay=tres.filter(k=>bk[k]);
    const peds=hay.map(k=>bk[k].ped), clis=hay.map(k=>bk[k].cli.size);
    const f=a=>!a.length?1:(_vara==="mejor3"?Math.max(...a):Math.round(a.reduce((x,y)=>x+y,0)/a.length));
    promPed=f(peds)||1; promCli=f(clis)||1;
  }else{
    promPed=Math.round(prev.reduce((s,m)=>s+bk[m].ped,0)/nP)||1;
    promCli=Math.round(prev.reduce((s,m)=>s+bk[m].cli.size,0)/nP)||1;
  }
  const actPed=bk[mes]?bk[mes].ped:0, actCli=bk[mes]?bk[mes].cli.size:0;
  /* DEUDA de SUS ventas (saldos iniciales afuera), repartida por ANTIGÜEDAD. Los tramos son lo que
     alimenta el índice de mora: no da lo mismo deber $1 M hace una semana que hace un año. */
  let porCobrar=0, vencido=0;
  const mora={d30:0,d60:0,d90:0,d180:0,mas:0};
  const _tope=new Date(r.topeVenc+"T00:00:00");
  for(const L of (deuLin||[])){
    const res=+L.amount_residual||0; if(!(res>0)) continue;
    porCobrar+=res;
    if(!L.date_maturity) continue;
    const d=Math.floor((_tope-new Date(String(L.date_maturity).slice(0,10)+"T00:00:00"))/86400000);
    if(d<=0) continue;
    vencido+=res;
    if(d<=30) mora.d30+=res; else if(d<=60) mora.d60+=res; else if(d<=90) mora.d90+=res;
    else if(d<=180) mora.d180+=res; else mora.mas+=res;
  }
  // ofertas colocadas (clientes de su cartera que compraron una oferta dentro de su vigencia)
  let ofVendidas=0; const idset=new Set(ids);
  for(const o of (ofertasMes||[])){
    const pids=(o.items||[]).map(i=>i&&i.id).filter(Boolean); if(!pids.length||!ids.length) continue;
    // la ventana se acota al mes liquidado: una oferta publicada en julio no puede sumar
    // sus clientes de julio al nivel de septiembre (misma regla que comercial/panel.html)
    let d=(o.desde||r.ini).slice(0,10), h=(o.hasta||r.fin).slice(0,10);
    if(d<r.ini) d=r.ini;
    if(h>r.fin) h=r.fin;
    if(h<d) continue;
    try{
      const g=await rpc("sale.order.line","read_group",[[["product_id","in",pids],["state","in",["sale","done"]],["order_id.date_order",">=",d],["order_id.date_order","<=",h+" 23:59:59"]],["price_subtotal:sum"],["order_partner_id"]],{lazy:false});
      ofVendidas+=g.map(x=>x.order_partner_id&&x.order_partner_id[0]).filter(p=>p&&idset.has(p)).length;
    }catch(e){}
  }
  const corte=(((EYG&&EYG.argToday)?EYG.argToday():r.fin)<r.fin)?((EYG&&EYG.argToday)?EYG.argToday():r.fin):r.fin;
  return { cartera:cart.length, fichas, cobradoMes, objetivoCobro, promPed, promCli, actPed, actCli,
    porCobrar, vencido, mora, ofEnviadas:(ofEnv||[]).length, ofVendidas,
    nuevos:nuevosAltas.length, nuevosAltas:nuevosAltas.length, nuevosCompraron, nuevosCuentan, nuevosDetalle,
    contactosUltDia:new Set((waMsgs||[]).map(m=>m.res_id)).size,
    diaConstancia:r.diaConstancia, findeCorregido:r.diaConstancia!==corte };
}

/* ===== nivel y salud, a partir de los datos crudos (función pura) ===== */
/* NIVEL. Desde el paquete de octubre entra un séptimo ítem: las SEMANAS en que llegó al mínimo de
   venta. Va acá y no en la salud porque el nivel mide conducta —el ritmo del trabajo— y la semana es
   el ritmo; el resultado del mes, en cambio, pega en la salud. Para hacerle lugar se le sacaron 10
   puntos al cobro y a la actividad, así los siete ítems siguen sumando 100. */
function nivelDe(g,perfil,cfg,mes){
  const nuevo=EYG.paqueteRige(mes,cfg);
  const pk=perfil==="externo"?"farm":perfil;
  // antes del paquete: 10 contactos/día y una meta única de 3 clientes nuevos dados de alta
  const _cMeta=nuevo?((cfg&&cfg.contactosDia)||15):10;
  const cuentanCompraron=nuevo&&(((cfg&&cfg.nuevosCuentan)||"compraron")==="compraron");
  const _nMeta=nuevo?(((cfg&&cfg.nuevosMeta)||{inst:5,farm:10,externo:10})[perfil]||10):3;
  const _nHechos=cuentanCompraron?(g.nuevosCompraron||0):(g.nuevosAltas||g.nuevos||0);
  const NP=(nuevo&&cfg&&cfg.nivelPesos)||null;
  const sp=(NP&&NP[pk])||PERFIL[pk]||PERFIL.farm;
  const rValor=g.objetivoCobro>0?Math.min(g.cobradoMes/g.objetivoCobro,1):0;
  const rPed=g.promPed>0?Math.min(g.actPed/g.promPed,1):0, rCli=g.promCli>0?Math.min(g.actCli/g.promCli,1):0;
  const rAct=(rPed+rCli)/2;
  const M=n=>"$"+Math.round(n||0).toLocaleString("es-AR");
  const items=[
    {ic:"💰",lab:"Cobro vs objetivo de cobranza",max:sp.valor,pts:sp.valor*rValor,det:"cobró "+M(g.cobradoMes)+" de "+M(g.objetivoCobro)+" ("+Math.round(rValor*100)+"%)"},
    {ic:"📞",lab:"Actividad (pedidos y clientes)",max:sp.activ,pts:sp.activ*rAct,det:g.actPed+" pedidos (su promedio "+g.promPed+") y "+g.actCli+" clientes (promedio "+g.promCli+") = "+Math.round(rAct*100)+"%"},
    {ic:"📤",lab:"Ofertas enviadas",max:OF_PTS_ENV,pts:OF_PTS_ENV*Math.min(g.ofEnviadas/OF_META_ENV,1),det:g.ofEnviadas+" de "+OF_META_ENV},
    {ic:"🎁",lab:"Ofertas vendidas",max:OF_PTS_VEN,pts:OF_PTS_VEN*Math.min(g.ofVendidas/OF_META_VEN,1),det:g.ofVendidas+" clientes de "+OF_META_VEN},
    {ic:"🆕",lab:"Clientes nuevos",max:NUEVOS_PTS,pts:NUEVOS_PTS*Math.min(_nHechos/_nMeta,1),
      det:_nHechos+" de "+_nMeta+(cuentanCompraron?(" que compraron"+((g.nuevosAltas||0)>(g.nuevosCompraron||0)?"  ·  "+((g.nuevosAltas||0)-(g.nuevosCompraron||0))+" altas sin comprar":"")):" dados de alta")},
    {ic:"🔥",lab:"Constancia ("+_cMeta+" contactos/día)",max:CONST_PTS,pts:CONST_PTS*Math.min(g.contactosUltDia/_cMeta,1),det:g.contactosUltDia+" contactos el "+(g.diaConstancia||"último día")+(g.findeCorregido?" (último día hábil: sábados y domingos no descuentan)":"")},
  ];
  if(nuevo && g.semanasMin && g.semanasMin.total>0){
    const sm=g.semanasMin, max=(NP&&NP.semanal)||10;
    // se pondera por días hábiles: una semana cortada por el mes no vale lo mismo que una entera
    const ratio=sm.habilesTot>0?sm.habilesOk/sm.habilesTot:0;
    items.push({ic:"📅",lab:"Mínimo de venta semanal",max,pts:max*ratio,
      det:sm.ok+" de "+sm.total+" semanas al mínimo ("+Math.round(ratio*100)+"% de los días hábiles)"});
  }
  const pts=items.reduce((s,i)=>s+i.pts,0);
  const idx=pts<40?0:pts<60?1:pts<80?2:pts<95?3:4;
  return {pts,idx,mult:NIV[idx].m,nombre:NIV[idx].n,emoji:NIV[idx].e,items};
}
/* SALUD. prop = qué parte del mes transcurrió (1 = mes cerrado); la vara de facturación va
   prorrateada por días hábiles, porque al día 5 no se le puede exigir el mes entero.
   Desde el paquete de octubre cambian dos de los tres ítems:
     · el vencido pasa a medirse por MORA (ponderada por antigüedad), no por porcentaje
     · la vara de facturación pasa a ser el MÍNIMO DE VENTA del mes, no su propia mediana
   Antes de paqueteDesde se calcula con las reglas viejas, tal como las vieron las comerciales. */
function saludDe(g,neto,baseline,prop,cfg,mes,minimo){
  const M=n=>"$"+Math.round(n||0).toLocaleString("es-AR");
  const nuevo=EYG.paqueteRige(mes,cfg);
  const venc=g.porCobrar>0?g.vencido/g.porCobrar:0;
  if(!nuevo){
    // ——— reglas hasta septiembre de 2026: vencido 45 / facturado 30 / fichas 25, piso = su mediana
    const esperado=(baseline||0)*(prop==null?1:prop);
    const factRatio=esperado>0?(neto||0)/esperado:1;
    const pV=cl((venc-0.10)/0.40,0,1)*45, pF=cl((1-factRatio)/0.30,0,1)*30, pO=cl((0.40-g.fichas)/0.40,0,1)*25;
    const salud=Math.max(0,100-pV-pF-pO);
    return { salud, penaltyPt:(100-salud)/100, venc, fichas:g.fichas, factRatio,
      items:[{ic:"🩸",lab:"Vencido de sus ventas",resta:pV,max:45,det:M(g.vencido)+" vencido = "+Math.round(venc*100)+"% de "+M(g.porCobrar)+" por cobrar (solo lo que vendió, sin saldos iniciales)"},
             {ic:"📉",lab:"Facturado vs su piso",resta:pF,max:30,det:Math.round(factRatio*100)+"% del ritmo esperado"+((prop!=null&&prop<1)?" (piso prorrateado por días hábiles: "+M(esperado)+" al día de hoy)":"")},
             {ic:"🗂️",lab:"Fichas completas",resta:pO,max:25,det:Math.round(g.fichas*100)+"% de la cartera"}]};
  }
  const P=(cfg&&cfg.saludPesos)||{mora:60,minimo:30,fichas:10};
  const U=(cfg&&cfg.saludUmbrales)||{minimoRango:0.50,fichasMin:0.40};
  // MORA: el vencido ponderado por antigüedad. Reemplaza al porcentaje, que dejaba pasar el peor
  // caso — una cartera con poco vencido pero muy viejo no penalizaba nada.
  const indice=EYG.moraIndice(g.mora, g.porCobrar, cfg);
  const pV=EYG.moraResta(indice, cfg, P.mora);
  // MÍNIMO DE VENTA del mes, prorrateado por los días hábiles transcurridos
  const exigido=(minimo&&minimo.mensual>0)?minimo.mensual*(prop==null?1:prop):0;
  const cumpl=exigido>0?(neto||0)/exigido:1;
  const pF=exigido>0?cl((1-cumpl)/(U.minimoRango||0.50),0,1)*P.minimo:0;
  const pO=cl(((U.fichasMin||0.40)-g.fichas)/(U.fichasMin||0.40),0,1)*P.fichas;
  const salud=Math.max(0,100-pV-pF-pO);
  const _vj=v=>v.toFixed(2).replace(".",",");
  return { salud, penaltyPt:(100-salud)/100, venc, fichas:g.fichas, factRatio:cumpl, moraIndice:indice, mora:g.mora, exigido,
    items:[{ic:"🩸",lab:"Mora de sus ventas",resta:pV,max:P.mora,
            det:M(g.vencido)+" vencido de "+M(g.porCobrar)+" por cobrar · índice de mora "+_vj(indice)+
                ((g.mora&&g.mora.mas>0)?"  ·  "+M(g.mora.mas)+" vencido hace más de 180 días":"")},
           {ic:"📉",lab:"Mínimo de venta del mes",resta:pF,max:P.minimo,
            det:exigido>0?(M(neto)+" de "+M(exigido)+" = "+Math.round(cumpl*100)+"%"+((prop!=null&&prop<1)?" (mínimo prorrateado por días hábiles al día de hoy)":"")):"sin mínimo cargado para su rubro"},
           {ic:"🗂️",lab:"Fichas completas",resta:pO,max:P.fichas,det:Math.round(g.fichas*100)+"% de la cartera"}]};
}

/* ===== CIERRE COMPLETO DE UN MES =====
   sellers  = [{uid,name,team}]  · monthly = {uid:{"YYYY-MM":neto}} (para la meta) · ticket = {uid:promedio}
   Devuelve el mismo objeto que se congela. onPaso(txt) para el cartelito de progreso. */
async function calcularMes(mes,{sellers,monthly,ticket,cfg,excluir},onPaso){
  const r=rango(mes);
  const ex=new Set(excluir||[]);
  const esExterno=nm=>/Samanta/i.test(nm||"");
  const rates=cfg.rates||EYG.COMI_DEF.rates;
  /* Ofertas cuya vigencia toca este mes (para "ofertas vendidas", 17 de los 100 puntos
     del nivel, y el nivel multiplica la comisión).
     EL HISTORIAL NO ES OPCIONAL ACÁ: una liquidación se cierra DESPUÉS de que terminó el
     mes, cuando esas ofertas ya vencieron y probablemente se dieron de baja para publicar
     las del mes nuevo. Leyendo sólo los parámetros vivos, liquidar septiembre en octubre
     daba cero ofertas vendidas para todas. eyg.ofertas_hist guarda lo dado de baja con su
     ventana, y además trae las de precios con la variante ya resuelta — que por no tener
     'items' nunca habían entrado en esta cuenta. */
  let ofertasMes=[];
  try{
    const [a,b,c]=await Promise.all([
      rpc("ir.config_parameter","get_param",["eyg.ofertas"]).catch(()=>"[]"),
      rpc("ir.config_parameter","get_param",["eyg.sync_ofertas"]).catch(()=>"[]"),
      rpc("ir.config_parameter","get_param",["eyg.ofertas_hist"]).catch(()=>"[]"),
    ]);
    const P=s=>{ try{ return JSON.parse(s||"[]")||[]; }catch(e){ return []; } };
    const vistos=new Set();
    ofertasMes=[...P(a),...P(b),...P(c)].filter(o=>o&&o.id&&(o.items||[]).length)
      .filter(o=>{ if(vistos.has(o.id)) return false; vistos.add(o.id); return true; })   // lo vivo gana
      .filter(o=>(o.desde||"2000-01-01").slice(0,10)<=r.fin && (o.hasta||"2999-12-31").slice(0,10)>=r.ini);
  }catch(e){}

  const exList=await excluidos(true);            // comprobantes que Dirección sacó del cálculo
  const exIds=exclIds(exList);
  const filas=[];
  for(const s of sellers){
    if(ex.has(s.uid)) continue;
    if(onPaso) onPaso(s.name);
    const f=await facturado(s.uid,r,exIds);
    const neto=f.facturas-f.nc;
    const perfil=EYG.perfilDe(s.uid,(ticket||{})[s.uid],cfg,s.name);
    const md=EYG.metaDesde(monthly[s.uid]||{}, mes, cfg, perfil);   // trae la meta y, aparte, el mínimo de venta
    const externo=perfil==="externo";
    const corte=externo?(cfg.externoCorte||50e6):md.meta;
    const rt=externo?rates.externo:(rates[perfil]||rates.farm);
    const t1=Math.min(neto,corte), t2=Math.max(neto-corte,0);
    const comiBase=t1*rt.base+t2*rt.high;
    let nivel=null, salud=null, tasaAplicada={base:rt.base,high:rt.high}, comiFinal=comiBase;
    if(!externo){
      const g=await gamificacion(s.uid,r,ofertasMes,cfg);
      // SEMANAS AL MÍNIMO: con el neto día por día se mira cada semana contra su propio mínimo
      // (prorrateado por hábiles, así una semana cortada por el mes no exige lo mismo que una entera).
      if(md.minimo){
        const ws=(md.minimo.semanas||[]).map(w=>{
          let v=0; for(const k in (f.porDia||{})) if(k>=w.desde&&k<=w.hasta) v+=f.porDia[k];
          return Object.assign({}, w, { facturado:v, cumple:w.minimo>0?v>=w.minimo:true });
        });
        const cerradas=ws.filter(w=>w.hasta<=r.topeVenc);   // una semana en curso no se juzga todavía
        g.semanasMin={ lista:ws, total:cerradas.length, ok:cerradas.filter(w=>w.cumple).length,
          habilesTot:cerradas.reduce((s,w)=>s+w.habiles,0),
          habilesOk:cerradas.filter(w=>w.cumple).reduce((s,w)=>s+w.habiles,0) };
      }
      nivel=nivelDe(g,perfil,cfg,mes);
      // si el mes todavía corre, la vara va prorrateada por los DÍAS HÁBILES transcurridos
      salud=saludDe(g,neto,md.baseline,r.propHabil,cfg,mes,md.minimo);
      tasaAplicada={ base:Math.max(0,rt.base-salud.penaltyPt/100), high:Math.max(0,rt.high-salud.penaltyPt/100) };
      /* EL FRENO DEL 3%: desde el paquete de octubre el nivel multiplica SÓLO el tramo base. Lo que
         pasa la meta ya se paga al 3%, que es el máximo de la casa, y así la tasa efectiva se acerca
         al 3% desde abajo sin alcanzarlo nunca — sin recortar al final, que sería castigar a quien
         vendió mucho. Antes, 3% × Diamante 1,20 daba 3,6%. */
      comiFinal=(cfg.nivelSoloTramoBase!==false && EYG.paqueteRige(mes,cfg))
        ? (t1*tasaAplicada.base*nivel.mult + t2*tasaAplicada.high)
        : (t1*tasaAplicada.base+t2*tasaAplicada.high)*nivel.mult;
      nivel.crudo=g;
    }
    filas.push({ uid:s.uid, nombre:s.name, equipo:s.team||"", perfil, perfilNom:externo?"Externo":PERFIL[perfil].nom,
      ticket:(ticket||{})[s.uid]||0, ventana:md.meses, baseline:md.baseline, meta:md.meta,
      facturas:f.facturas, nc:f.nc, facturasIVA:f.facturasIVA, ncIVA:f.ncIVA, neto,
      ramaA:f.ramaA, ramaB:f.ramaB, corte, tasaTeorica:rt, tasaAplicada, t1, t2,
      comiBase, nivel, salud, comiFinal });
  }
  filas.sort((a,b)=>b.comiFinal-a.comiFinal);
  // se guardan también los comprobantes excluidos DE ESTE MES, con su motivo, para poder justificarlo
  const delMes=exList.filter(x=>x&&(!x.decidido||true)&&String(x.nombre||"").length);
  return { mes, generado:new Date().toISOString().slice(0,10), config:cfg, excluidos:[...ex],
    excluidosComprobantes:delMes, comerciales:filas };
}

/* ===== VISTA: el desglose que se le entrega a cada comercial ===== */
const M=n=>"$"+Math.round(n||0).toLocaleString("es-AR");
const M2=n=>"$"+(Math.round((n||0)*100)/100).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
const PC=n=>(n*100).toFixed(2).replace(".",",")+"%";
const P1=n=>n.toFixed(1).replace(".",",");
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const MESES_L=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const mesLargo=k=>{ const [y,m]=String(k).split("-"); return (MESES_L[(+m)-1]||k)+" "+y; };

/* Los clientes nuevos con nombre y apellido: cuáles compraron y cuáles quedaron en una ficha.
   Es el control que pidió Dirección — que no sean altas inventadas y se pueda seguir si se les vendió. */
function nuevosHTML(r){
  const d=(r.nivel&&r.nivel.crudo&&r.nivel.crudo.nuevosDetalle)||[];
  if(!d.length) return "";
  const si=d.filter(x=>x.compro), no=d.filter(x=>!x.compro);
  const fila=x=>'<tr><td>'+esc(x.nombre)+'</td><td class="n">'+fD(x.alta)+'</td><td class="n">'+
    (x.compro?('✅ '+x.pedidos+' ped · '+M(x.monto)):'<span style="color:var(--gris2)">sin comprar</span>')+'</td></tr>';
  return '<div class="lqnuevos"><table>'+
    '<tr><th>Cliente dado de alta</th><th class="n">Alta</th><th class="n">¿Compró?</th></tr>'+
    si.map(fila).join("")+no.map(fila).join("")+
    '</table><div class="lqnsub">'+si.length+' de '+d.length+' compraron. Los que no, quedan para revisar: un alta sin venta no suma puntos.</div></div>';
}
function hojaHTML(r){
  const ext=r.perfil==="externo";
  const rec=r.salud?(r.tasaTeorica.base-r.tasaAplicada.base):0;
  const paso=(n,tit,ex,cuerpo,nota,fin)=>`<div class="lqpaso${fin?" fin":""}"><div class="lqn">${n}</div><div class="lqc">
      <h3>${tit}</h3>${ex?`<p class="lqex">${ex}</p>`:""}${cuerpo}${nota?`<p class="lqnota">${nota}</p>`:""}</div></div>`;
  const fila=(a,b,cls)=>`<tr${cls?` class="${cls}"`:""}><td>${a}</td><td class="n">${b}</td></tr>`;
  let h=`<div class="lqhoja">
    <div class="lqcab"><div><div class="lqquien">${esc(r.nombre)}</div>
      <div class="lqsub">${esc(r.equipo)} · perfil <b>${esc(r.perfilNom)}</b>${ext?"":" · ticket promedio "+M(r.ticket)}</div></div>
      <div class="lqper"><div class="pl">Comisión</div><div class="pv">${M2(r.comiFinal)}</div></div></div>`;

  h+=paso(1,"Lo que facturó en el mes",
    "La comisión se calcula sobre el <b>facturado neto</b>: las facturas que salieron de <b>sus pedidos</b>, menos sus notas de crédito, sin IVA. No importa quién emitió la factura: se cuenta a su nombre porque el pedido lo hizo ella.",
    `<table class="lqt">${fila("Facturas emitidas (neto, sin IVA)",M2(r.facturas))}${fila("Notas de crédito (se restan)",'<span class="neg">− '+M2(r.nc)+"</span>")}${fila("<b>Facturado neto del mes</b>",M2(r.neto),"tot")}</table>`,
    `Como referencia, con IVA: ${M(r.facturasIVA)} facturado y ${M(r.ncIVA)} de notas de crédito. El IVA no entra en el cálculo.`+
    (r.ramaB>0?` <b>Incluye ${M(r.ramaB)} de pedidos cargados bajo la cuenta genérica</b> que se le atribuyen por ser clientes de su cartera.`:""));

  if(ext){
    h+=paso(2,"Su escalera (régimen externo)",
      `Esquema fijo, sin metas ni nivel: <b>${PC(r.tasaTeorica.base)}</b> hasta ${M(r.corte)} y <b>${PC(r.tasaTeorica.high)}</b> por lo que lo supere.`,
      `<table class="lqt">${fila(`${M2(r.t1)} × ${PC(r.tasaTeorica.base)}`,M2(r.t1*r.tasaTeorica.base))}${r.t2>0?fila(`${M2(r.t2)} × ${PC(r.tasaTeorica.high)}`,M2(r.t2*r.tasaTeorica.high)):""}${fila("<b>Comisión del mes</b>",'<span class="big">'+M2(r.comiFinal)+"</span>","tot")}</table>`,
      "",true);
    return h+"</div>";
  }

  h+=paso(2,"Su meta: "+M(r.meta),
    `La meta es propia, no del equipo: su <b>mes típico</b> (la ${(r.config&&r.config.metaMetodo==="promedio")?"promedio":"mediana"} de sus últimos meses cerrados) <b>+ ${Math.round(((r.metaCrec!=null?r.metaCrec:0.20))*100)}%</b>. La mediana es el del medio, así un mes muy alto o muy bajo no le mueve la meta.`,
    `<table class="lqt">${r.ventana.map(v=>fila(mesLargo(v.key),v.net==null?"—":M2(v.net))).join("")}${fila("Su mes típico",M2(r.baseline))}${fila("<b>Meta del mes</b>",M2(r.meta),"tot")}</table>`,
    r.neto>=r.meta?`Superó su meta por ${M(r.neto-r.meta)}. 🎉`:`Quedó a ${M(r.meta-r.neto)} de su meta (llegó al ${r.meta>0?Math.round(r.neto/r.meta*100):0}%).`);

  h+=paso(3,"La escalera: dos tramos",
    `Hasta la meta cobra la tasa base de su perfil (<b>${PC(r.tasaTeorica.base)}</b>); por todo lo que la supera, la tasa alta (<b>${PC(r.tasaTeorica.high)}</b>). Cruzar la meta es lo que sube la tasa.`,
    `<table class="lqt">${fila("Hasta la meta ("+M(r.corte)+")",M2(r.t1))}${fila("Por encima de la meta",r.t2>0?M2(r.t2):"—")}</table>`);

  h+=paso(4,`Su nivel: ${r.nivel.emoji} ${r.nivel.nombre} · multiplica ×${r.nivel.mult.toFixed(2)}`,
    "El nivel es <b>premio</b>: suma puntos cumpliendo sus objetivos y multiplica toda la comisión. Sobre 100 puntos: 🥉 menos de 40 · 🥈 40 · 🥇 60 · 💎 80 · 👑 95.",
    `<table class="lqt pts">${r.nivel.items.map(i=>fila(`${i.ic||""} ${esc(i.lab)}<span class="det">${esc(i.det)}</span>${/Clientes nuevos/.test(i.lab)?nuevosHTML(r):""}`,`${P1(i.pts)} <span class="de">/ ${i.max}</span>`)).join("")}${fila("<b>Total</b>",`${P1(r.nivel.pts)} / 100 → ${r.nivel.emoji} ${r.nivel.nombre} ×${r.nivel.mult.toFixed(2)}`,"tot")}</table>`);

  h+=paso(5,`Salud de la cuenta: ${Math.round(r.salud.salud)}%${rec>0.00005?` · recorta ${(rec*100).toFixed(2).replace(".",",")} puntos de tasa`:" · sin recorte"}`,
    "La salud es el <b>freno</b>: arranca en 100 y baja por deuda vencida, por facturar bajo su propio ritmo y por fichas incompletas. Lo que baja se descuenta de la tasa, hasta 1 punto como máximo.",
    `<table class="lqt pts">${r.salud.items.map(i=>fila(`${i.ic||""} ${esc(i.lab)}<span class="det">${esc(i.det)}</span>`,i.resta>0.05?`− ${P1(i.resta)} <span class="de">/ ${i.max}</span>`:"sin resta")).join("")}${fila("<b>Salud de la cuenta</b>",Math.round(r.salud.salud)+" / 100","tot")}</table>`,
    `Tasas que le quedaron: <b>${PC(r.tasaAplicada.base)}</b> hasta la meta y <b>${PC(r.tasaAplicada.high)}</b> por encima${rec>0.00005?` (las teóricas son ${PC(r.tasaTeorica.base)} / ${PC(r.tasaTeorica.high)}).`:"."}`);

  h+=paso("=","La cuenta completa","",
    `<table class="lqt">${fila(`${M2(r.t1)} × ${PC(r.tasaAplicada.base)} <span class="de">(hasta la meta)</span>`,M2(r.t1*r.tasaAplicada.base))}${r.t2>0?fila(`${M2(r.t2)} × ${PC(r.tasaAplicada.high)} <span class="de">(sobre la meta)</span>`,M2(r.t2*r.tasaAplicada.high)):""}${fila("Subtotal",M2(r.t1*r.tasaAplicada.base+r.t2*r.tasaAplicada.high))}${fila(`× nivel ${r.nivel.emoji} ${r.nivel.nombre}`,"× "+r.nivel.mult.toFixed(2))}${fila("<b>Comisión del mes</b>",M2(r.comiFinal),"tot grande")}</table>`,
    "",true);
  return h+"</div>";
}

function docHTML(data,cerrado){
  const cs=data.comerciales||[];
  const tot=cs.reduce((s,r)=>s+r.comiFinal,0), totNeto=cs.reduce((s,r)=>s+(r.neto||0),0);
  const crec=Math.round(((data.config&&data.config.metaCrecimiento)||0.20)*100);
  cs.forEach(r=>{ r.config=data.config; r.metaCrec=(data.config&&data.config.metaCrecimiento); });
  return `<div class="lqdoc">
    <div class="lqestado ${cerrado?"cerrado":"abierto"}">${cerrado
      ? `🔒 <b>Mes liquidado</b> — congelado el ${esc(data.liquidadoEl||data.generado)}. Estos números ya no cambian.`
      : `🔓 <b>Mes abierto</b> — se recalcula cada vez que se abre. Al apretar <b>Liquidar</b> queda congelado.`}</div>
    <div class="lqres">
      <table class="lqrt">
        <tr><th>Comercial</th><th class="n">Facturado neto</th><th class="n">Meta</th><th class="n">Nivel</th><th class="n">Comisión</th></tr>
        ${cs.map(r=>`<tr><td><b>${esc(r.nombre)}</b><br><span class="lqchip">${esc(r.perfilNom)}</span></td>
          <td class="n">${M(r.neto)}</td><td class="n">${r.perfil==="externo"?"—":M(r.meta)}</td>
          <td class="n">${r.nivel?r.nivel.emoji+" "+r.nivel.nombre+" ×"+r.nivel.mult.toFixed(2):"—"}</td>
          <td class="n"><b>${M2(r.comiFinal)}</b></td></tr>`).join("")}
        <tr class="t"><td>Total a liquidar</td><td class="n">${M(totNeto)}</td><td class="n"></td><td class="n"></td><td class="n">${M2(tot)}</td></tr>
      </table>
    </div>
    ${(data.excluidosComprobantes||[]).length?`<div class="lqres" style="border-color:#F0DAA8;background:#FFFDF7">
      <div style="font-size:13.5px;font-weight:800;margin-bottom:8px">⚖️ Comprobantes que Dirección sacó del cálculo</div>
      <table class="lqrt"><tr><th>Comprobante</th><th>Cliente</th><th>Comercial</th><th class="n">Neto</th></tr>
      ${data.excluidosComprobantes.map(x=>`<tr><td><b>${esc(x.nombre)}</b><br><span style="font-size:11px;color:var(--gris2)">${esc(x.motivo||"")}</span></td>
        <td>${esc(x.cliente||"—")}</td><td>${esc(x.comercial||"—")}</td><td class="n">${M(x.neto)}</td></tr>`).join("")}</table>
      </div>`:""}
    ${cs.map(hojaHTML).join("")}
    <div class="lqpie"><b>La cuenta, en una línea:</b> comisión = (facturado neto hasta la meta × tasa base + lo que la supera × tasa alta) × nivel, con la tasa recortada por la salud de la cuenta.
      <ul><li><b>Facturado neto</b>: facturas menos notas de crédito, sin IVA, de las ventas que salieron de sus pedidos. Si un cliente cambió de cartera, la venta queda de quien la hizo.</li>
      <li><b>Meta</b>: ${(data.config&&data.config.metaMetodo==="promedio")?"promedio":"mediana"} de sus ${(data.config&&data.config.metaMeses)||3} meses cerrados + ${crec}%.</li>
      <li><b>Tasas</b>: Instituciones 2% / 3% · Farmacias 2,5% / 3,5% · Externo 3% / 4% fijo.</li>
      <li><b>Nivel</b>: 🥉 ×1,00 · 🥈 ×1,05 · 🥇 ×1,10 · 💎 ×1,15 · 👑 ×1,20.</li>
      <li><b>Salud</b>: cada punto que baja de 100 recorta 0,01 puntos de tasa (máximo 1 punto).</li></ul>
      ${cerrado?"":'<p style="margin:8px 0 0"><b>Ojo:</b> el vencido y las fichas se miden en el momento en que se abre esta pantalla (Odoo no guarda foto histórica). Por eso conviene liquidar apenas cierra el mes.</p>'}
    </div>
  </div>`;
}

window.EYGLIQ={ rango, cierresLeer, cierreLeer, cierreGuardar, cierreReabrir, cierreKey,
  facturado, gamificacion, nivelDe, saludDe, calcularMes, hojaHTML, docHTML, PERFIL, NIV,
  EXCL_KEY, excluidos, exclIds };
})();
