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
const PERFIL={ inst:{valor:38,activ:12,nom:"Instituciones"}, farm:{valor:25,activ:25,nom:"Farmacias / Comercial"} };
const OF_PTS_ENV=8, OF_META_ENV=30, OF_PTS_VEN=17, OF_META_VEN=10;
const NUEVOS_META=3, NUEVOS_PTS=20, CONST_META=10, CONST_PTS=5;
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
  const menos=(dias)=>{ const d=new Date(y,m-1,ult); d.setDate(d.getDate()-dias);
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
  // Corte del VENCIDO: el último día del mes, o hoy si el mes todavía está corriendo (no se puede dar
  // por vencida una factura cuyo plazo aún no llegó). Fijarlo así hace que el número sea reproducible.
  const hoy=(EYG&&EYG.argToday)?EYG.argToday():new Date().toISOString().slice(0,10);
  const topeVenc=(hoy<fin)?hoy:fin;
  return { ini, fin, finH:fin+" 23:59:59", d100:menos(100), d190:menos(190), dias:ult, topeVenc };
}
const pctFicha=c=>{ const has={name:!!c.name,tel:!!(c.phone||c.mobile),email:!!c.email,street:!!c.street,zip:!!c.zip,city:!!c.city,
  state:!!(c.state_id&&c.state_id[0]),idtype:!!(c.l10n_latam_identification_type_id&&c.l10n_latam_identification_type_id[0]),
  vat:!!c.vat,fiscal:!!(c.l10n_ar_afip_responsibility_type_id&&c.l10n_ar_afip_responsibility_type_id[0])};
  return Math.round(REQ.filter(k=>has[k]).length/REQ.length*100); };

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
async function facturado(uid,r){
  const base=mt=>[["parent_state","=","posted"],["move_id.move_type","=",mt],["date",">=",r.ini],["date","<=",r.fin]];
  const A=mt=>[...base(mt),["sale_line_ids.order_id.user_id","=",uid]];
  const B=mt=>[...base(mt),["sale_line_ids.order_id.user_id","=",GEN],["sale_line_ids.order_id.partner_id.user_id","=",uid]];
  const g=(dom)=>rpc("account.move.line","read_group",[dom,["price_subtotal:sum","price_total:sum"],[]],{lazy:false}).catch(()=>[]);
  const [ai,ar,bi,br]=await Promise.all([g(A("out_invoice")),g(A("out_refund")),g(B("out_invoice")),g(B("out_refund"))]);
  const v=(x,f)=>((x[0]||{})[f])||0;
  return {
    facturas: v(ai,"price_subtotal")+v(bi,"price_subtotal"),
    nc:       v(ar,"price_subtotal")+v(br,"price_subtotal"),
    facturasIVA: v(ai,"price_total")+v(bi,"price_total"),
    ncIVA:       v(ar,"price_total")+v(br,"price_total"),
    ramaA: v(ai,"price_subtotal")-v(ar,"price_subtotal"),
    ramaB: v(bi,"price_subtotal")-v(br,"price_subtotal"),
  };
}

/* ===== los 6 ítems del nivel + los 3 de la salud, para un comercial y un mes ===== */
async function gamificacion(uid,r,ofertasMes){
  const u=await rpc("res.users","read",[[uid]],{fields:["id","name","partner_id"]});
  const uPartner=u[0]&&u[0].partner_id&&u[0].partner_id[0];
  const cart=await rpc("res.partner","search_read",[[["user_id","=",uid],["type","=","contact"],["parent_id","=",false]]],{fields:PFIELDS,limit:0});
  const ids=cart.map(c=>c.id);
  const fichas=cart.length?cart.filter(c=>pctFicha(c)>=100).length/cart.length:0;
  const pay=(desde,hasta)=>rpc("account.payment","read_group",[[["partner_id","in",ids],["payment_type","=","inbound"],["state","=","posted"],["date",">=",desde],["date","<=",hasta]],["amount:sum"],[]],{lazy:false}).catch(()=>[]);
  const recv=extra=>rpc("account.move.line","read_group",[[["account_id.account_type","=","asset_receivable"],["parent_state","=","posted"],["full_reconcile_id","=",false],["amount_residual",">",0],...extra,["partner_id","in",ids]],["amount_residual:sum"],["partner_id"]],{lazy:false}).catch(()=>[]);
  const [cobMes,cob100,ordHist,nuevos,ccLines,ovG,migG,waMsgs,ofEnv]=await Promise.all([
    pay(r.ini,r.fin), pay(r.d100,r.fin),
    rpc("sale.order","search_read",[[["user_id","=",uid],["state","in",["sale","done"]],["date_order",">=",r.d190],["date_order","<=",r.finH]]],{fields:["partner_id","date_order"],limit:0}).catch(()=>[]),
    rpc("res.partner","search_count",[[["user_id","=",uid],["type","=","contact"],["parent_id","=",false],["create_date",">=",r.ini],["create_date","<=",r.finH]]]).catch(()=>0),
    ids.length?rpc("res.partner","read",[ids],{fields:["total_due"],context:{lang:"es_AR"}}).catch(()=>[]):[],
    recv([["date_maturity","<=",r.topeVenc]]), recv([["date_maturity","=",false]]),
    ids.length?rpc("mail.message","search_read",[[["model","=","res.partner"],["res_id","in",ids],["date",">=",r.fin+" 00:00:00"],["date","<=",r.finH],"|",["body","like","EyGWA"],["body","like","EyGCRM"]]],{fields:["res_id"],limit:0}).catch(()=>[]):[],
    uPartner?rpc("mail.message","search_read",[[["model","=","res.partner"],["res_id","=",uPartner],["date",">=",r.ini+" 00:00:00"],["date","<=",r.finH],["body","like","EyGOFENV"]]],{fields:["date"],limit:0}).catch(()=>[]):[],
  ]);
  // cobro
  const cobradoMes=((cobMes[0]||{}).amount)||0;
  const objetivoCobro=(((cob100[0]||{}).amount)||0)/3*1.1;
  // actividad
  const bk={};
  for(const o of ordHist){ const m=(o.date_order||"").slice(0,7); if(!m)continue; (bk[m]=bk[m]||{ped:0,cli:new Set()}); bk[m].ped++; if(o.partner_id)bk[m].cli.add(o.partner_id[0]); }
  const mes=r.ini.slice(0,7);
  const prev=Object.keys(bk).filter(m=>m<mes), nP=prev.length||1;
  const promPed=Math.round(prev.reduce((s,m)=>s+bk[m].ped,0)/nP)||1;
  const promCli=Math.round(prev.reduce((s,m)=>s+bk[m].cli.size,0)/nP)||1;
  const actPed=bk[mes]?bk[mes].ped:0, actCli=bk[mes]?bk[mes].cli.size:0;
  // deuda / vencido
  const ovMap={},migMap={};
  (ovG||[]).forEach(g=>{ if(g.partner_id) ovMap[g.partner_id[0]]=g.amount_residual||0; });
  (migG||[]).forEach(g=>{ if(g.partner_id) migMap[g.partner_id[0]]=g.amount_residual||0; });
  let porCobrar=0,vencido=0;
  for(const c of (ccLines||[])){ const d=(typeof c.total_due==="number")?c.total_due:0;
    if(d>1){ porCobrar+=d; vencido+=Math.max(0,(ovMap[c.id]||0)+(migMap[c.id]||0)); } }
  // ofertas colocadas (clientes de su cartera que compraron una oferta dentro de su vigencia)
  let ofVendidas=0; const idset=new Set(ids);
  for(const o of (ofertasMes||[])){
    const pids=(o.items||[]).map(i=>i&&i.id).filter(Boolean); if(!pids.length||!ids.length) continue;
    const d=(o.desde||r.ini).slice(0,10), h=(o.hasta||r.fin).slice(0,10);
    try{
      const g=await rpc("sale.order.line","read_group",[[["product_id","in",pids],["state","in",["sale","done"]],["order_id.date_order",">=",d],["order_id.date_order","<=",h+" 23:59:59"]],["price_subtotal:sum"],["order_partner_id"]],{lazy:false});
      ofVendidas+=g.map(x=>x.order_partner_id&&x.order_partner_id[0]).filter(p=>p&&idset.has(p)).length;
    }catch(e){}
  }
  return { cartera:cart.length, fichas, cobradoMes, objetivoCobro, promPed, promCli, actPed, actCli,
    porCobrar, vencido, ofEnviadas:(ofEnv||[]).length, ofVendidas, nuevos,
    contactosUltDia:new Set((waMsgs||[]).map(m=>m.res_id)).size };
}

/* ===== nivel y salud, a partir de los datos crudos (función pura) ===== */
function nivelDe(g,perfil){
  const sp=PERFIL[perfil==="externo"?"farm":perfil]||PERFIL.farm;
  const rValor=g.objetivoCobro>0?Math.min(g.cobradoMes/g.objetivoCobro,1):0;
  const rPed=g.promPed>0?Math.min(g.actPed/g.promPed,1):0, rCli=g.promCli>0?Math.min(g.actCli/g.promCli,1):0;
  const rAct=(rPed+rCli)/2;
  const M=n=>"$"+Math.round(n||0).toLocaleString("es-AR");
  const items=[
    {ic:"💰",lab:"Cobro vs objetivo de cobranza",max:sp.valor,pts:sp.valor*rValor,det:"cobró "+M(g.cobradoMes)+" de "+M(g.objetivoCobro)+" ("+Math.round(rValor*100)+"%)"},
    {ic:"📞",lab:"Actividad (pedidos y clientes)",max:sp.activ,pts:sp.activ*rAct,det:g.actPed+" pedidos (su promedio "+g.promPed+") y "+g.actCli+" clientes (promedio "+g.promCli+") = "+Math.round(rAct*100)+"%"},
    {ic:"📤",lab:"Ofertas enviadas",max:OF_PTS_ENV,pts:OF_PTS_ENV*Math.min(g.ofEnviadas/OF_META_ENV,1),det:g.ofEnviadas+" de "+OF_META_ENV},
    {ic:"🎁",lab:"Ofertas vendidas",max:OF_PTS_VEN,pts:OF_PTS_VEN*Math.min(g.ofVendidas/OF_META_VEN,1),det:g.ofVendidas+" clientes de "+OF_META_VEN},
    {ic:"🆕",lab:"Clientes nuevos",max:NUEVOS_PTS,pts:NUEVOS_PTS*Math.min(g.nuevos/NUEVOS_META,1),det:g.nuevos+" de "+NUEVOS_META},
    {ic:"🔥",lab:"Constancia (10 contactos/día)",max:CONST_PTS,pts:CONST_PTS*Math.min(g.contactosUltDia/CONST_META,1),det:g.contactosUltDia+" contactos el último día del mes"},
  ];
  const pts=items.reduce((s,i)=>s+i.pts,0);
  const idx=pts<40?0:pts<60?1:pts<80?2:pts<95?3:4;
  return {pts,idx,mult:NIV[idx].m,nombre:NIV[idx].n,emoji:NIV[idx].e,items};
}
/* prop = qué parte del mes transcurrió (1 = mes cerrado). El piso de facturación va PRORRATEADO,
   igual que en el panel: al día 5 no se le puede exigir el mes entero. */
function saludDe(g,neto,baseline,prop){
  const M=n=>"$"+Math.round(n||0).toLocaleString("es-AR");
  const venc=g.porCobrar>0?g.vencido/g.porCobrar:0;
  const esperado=(baseline||0)*(prop==null?1:prop);
  const factRatio=esperado>0?(neto||0)/esperado:1;
  const pV=cl((venc-0.10)/0.40,0,1)*45, pF=cl((1-factRatio)/0.30,0,1)*30, pO=cl((0.40-g.fichas)/0.40,0,1)*25;
  const salud=Math.max(0,100-pV-pF-pO);
  return { salud, penaltyPt:(100-salud)/100, venc, fichas:g.fichas, factRatio,
    items:[{ic:"🩸",lab:"Vencido de cartera",resta:pV,max:45,det:M(g.vencido)+" vencido = "+Math.round(venc*100)+"% de lo por cobrar"},
           {ic:"📉",lab:"Facturado vs su piso",resta:pF,max:30,det:Math.round(factRatio*100)+"% del ritmo esperado"+((prop!=null&&prop<1)?" (piso prorrateado: "+M(esperado)+" al día de hoy)":"")},
           {ic:"🗂️",lab:"Fichas completas",resta:pO,max:25,det:Math.round(g.fichas*100)+"% de la cartera"}]};
}

/* ===== CIERRE COMPLETO DE UN MES =====
   sellers  = [{uid,name,team}]  · monthly = {uid:{"YYYY-MM":neto}} (para la meta) · ticket = {uid:promedio}
   Devuelve el mismo objeto que se congela. onPaso(txt) para el cartelito de progreso. */
async function calcularMes(mes,{sellers,monthly,ticket,cfg,excluir},onPaso){
  const r=rango(mes);
  const ex=new Set(excluir||[]);
  const esExterno=nm=>/Samanta/i.test(nm||"");
  const rates=cfg.rates||EYG.COMI_DEF.rates;
  // ofertas cuya vigencia toca este mes (para "ofertas vendidas")
  let ofertasMes=[];
  try{
    const [a,b]=await Promise.all([
      rpc("ir.config_parameter","get_param",["eyg.ofertas"]).catch(()=>"[]"),
      rpc("ir.config_parameter","get_param",["eyg.sync_ofertas"]).catch(()=>"[]"),
    ]);
    const P=s=>{ try{ return JSON.parse(s||"[]")||[]; }catch(e){ return []; } };
    ofertasMes=[...P(a),...P(b)].filter(o=>o&&o.id&&(o.items||[]).length)
      .filter(o=>(o.desde||"2000-01-01").slice(0,10)<=r.fin && (o.hasta||"2999-12-31").slice(0,10)>=r.ini);
  }catch(e){}

  const filas=[];
  for(const s of sellers){
    if(ex.has(s.uid)) continue;
    if(onPaso) onPaso(s.name);
    const f=await facturado(s.uid,r);
    const neto=f.facturas-f.nc;
    const perfil=esExterno(s.name)?"externo":(((ticket||{})[s.uid]||0)>=(cfg.perfilTicket||300000)?"inst":"farm");
    const md=EYG.metaDesde(monthly[s.uid]||{}, mes, cfg);
    const externo=perfil==="externo";
    const corte=externo?(cfg.externoCorte||50e6):md.meta;
    const rt=externo?rates.externo:(rates[perfil]||rates.farm);
    const t1=Math.min(neto,corte), t2=Math.max(neto-corte,0);
    const comiBase=t1*rt.base+t2*rt.high;
    let nivel=null, salud=null, tasaAplicada={base:rt.base,high:rt.high}, comiFinal=comiBase;
    if(!externo){
      const g=await gamificacion(s.uid,r,ofertasMes);
      nivel=nivelDe(g,perfil);
      // si el mes todavía corre, el piso de facturación va prorrateado por el día en que estamos
      const hoy=(EYG&&EYG.argToday)?EYG.argToday():new Date().toISOString().slice(0,10);
      const prop=(hoy<r.fin)?(Number(hoy.slice(8,10))/r.dias):1;
      salud=saludDe(g,neto,md.baseline,prop);
      tasaAplicada={ base:Math.max(0,rt.base-salud.penaltyPt/100), high:Math.max(0,rt.high-salud.penaltyPt/100) };
      comiFinal=(t1*tasaAplicada.base+t2*tasaAplicada.high)*nivel.mult;
      nivel.crudo=g;
    }
    filas.push({ uid:s.uid, nombre:s.name, equipo:s.team||"", perfil, perfilNom:externo?"Externo":PERFIL[perfil].nom,
      ticket:(ticket||{})[s.uid]||0, ventana:md.meses, baseline:md.baseline, meta:md.meta,
      facturas:f.facturas, nc:f.nc, facturasIVA:f.facturasIVA, ncIVA:f.ncIVA, neto,
      ramaA:f.ramaA, ramaB:f.ramaB, corte, tasaTeorica:rt, tasaAplicada, t1, t2,
      comiBase, nivel, salud, comiFinal });
  }
  filas.sort((a,b)=>b.comiFinal-a.comiFinal);
  return { mes, generado:new Date().toISOString().slice(0,10), config:cfg, excluidos:[...ex], comerciales:filas };
}

/* ===== VISTA: el desglose que se le entrega a cada comercial ===== */
const M=n=>"$"+Math.round(n||0).toLocaleString("es-AR");
const M2=n=>"$"+(Math.round((n||0)*100)/100).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
const PC=n=>(n*100).toFixed(2).replace(".",",")+"%";
const P1=n=>n.toFixed(1).replace(".",",");
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const MESES_L=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const mesLargo=k=>{ const [y,m]=String(k).split("-"); return (MESES_L[(+m)-1]||k)+" "+y; };

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
    `<table class="lqt pts">${r.nivel.items.map(i=>fila(`${i.ic||""} ${esc(i.lab)}<span class="det">${esc(i.det)}</span>`,`${P1(i.pts)} <span class="de">/ ${i.max}</span>`)).join("")}${fila("<b>Total</b>",`${P1(r.nivel.pts)} / 100 → ${r.nivel.emoji} ${r.nivel.nombre} ×${r.nivel.mult.toFixed(2)}`,"tot")}</table>`);

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
  facturado, gamificacion, nivelDe, saludDe, calcularMes, hojaHTML, docHTML, PERFIL, NIV };
})();
