/* ===== EyG · motor compartido de comisión / nivel / salud (puro, sin datos) ===== */
window.EYGM = (function(){
  const RATES={ inst:{base:.020,high:.030}, farm:{base:.020,high:.030} };   // farmacias bajó a 2/3% el 1/10/2026
  const EXTERNOS=["Samanta Luna"];
  const PERFIL={ inst:{valor:38,activ:12,nom:"Instituciones"}, farm:{valor:25,activ:25,nom:"Farmacias"} };
  const NIV=[{n:"Bronce",e:"🥉",m:1},{n:"Plata",e:"🥈",m:1.05},{n:"Oro",e:"🥇",m:1.10},{n:"Platino",e:"💎",m:1.15},{n:"Diamante",e:"👑",m:1.20}];
  const cl=(x,a,b)=>Math.max(a,Math.min(b,x));

  /* El rubro lo fija Dirección (cfg.rubros). Se delega en core.js para no tener dos criterios: acá
     se adivinaba por el ticket y eso dejó de servir cuando se empezaron a asignar sectores. */
  function perfilDe(nombre, avgTicket, cfg, uid){
    if(cfg && window.EYG && EYG.perfilDe) return EYG.perfilDe(uid, avgTicket, cfg, nombre);
    if(EXTERNOS.includes(nombre)) return "externo";
    return (avgTicket||0)>=300000?"inst":"farm";
  }

  // d = {nombre, perfil, factMes, factBaseline, cobradoMes, objetivoCobro, vencido, porCobrar, fichasPct, nuevos, actividadRatio, ofEnviadas, ofVendidas, avgTicket, diaMesFrac}
  function salud(d){
    if(d.perfil==="externo") return {salud:100, penaltyPt:0, items:[]};
    const venc=d.porCobrar>0?d.vencido/d.porCobrar:0;
    /* Desde octubre la vara es el MÍNIMO DE VENTA del mes, no el piso histórico. Si el líder no lo
       recibió, se cae al piso viejo antes que inventar un número. */
    const _nuevo=!!(d.cfg && window.EYG && EYG.paqueteRige && d.mes && EYG.paqueteRige(d.mes,d.cfg));
    const esperado=((_nuevo&&d.minimoMensual>0)?d.minimoMensual:(d.factBaseline||0))*(d.diaMesFrac||1);
    const factRatio=esperado>0?d.factMes/esperado:1;
    /* Los mismos tres ítems que ve la comercial. Desde el paquete de octubre: mora ponderada por
       antigüedad en lugar del % de vencido, y el mínimo de venta en lugar de su propia mediana. */
    const P=(d.saludPesos)||{mora:60,minimo:30,fichas:10};
    // si la mora no se pudo medir queda a la vista: no se la reemplaza en silencio por el % viejo
    const _sinMora=(d.moraIndice==null);
    const pV=(!_sinMora&&EYG.moraResta)?EYG.moraResta(d.moraIndice,d.cfg,P.mora):cl((venc-0.10)/0.40,0,1)*(P.mora||P.vencido||60);
    const pF=cl((1-factRatio)/((d.minimoRango)||0.50),0,1)*(P.minimo||P.facturado||30), pO=cl((0.40-(d.fichasPct||0))/0.40,0,1)*P.fichas;
    const s=Math.max(0,100-pV-pF-pO);
    return {salud:s, penaltyPt:(100-s)/100,
      items:[{ic:"🩸",lab:"Mora de sus ventas",pts:pV,max:P.mora||P.vencido,det:_sinMora?"no se pudo medir la antigüedad · se usó el % de vencido ("+Math.round(venc*100)+"%)":("índice "+(d.moraIndice||0).toFixed(2).replace(".",",")+" · "+Math.round(venc*100)+"% vencido")},
             {ic:"📉",lab:"Mínimo de venta",pts:pF,max:P.minimo||P.facturado,det:Math.round(factRatio*100)+"% del ritmo"},
             {ic:"🗂️",lab:"Fichas",pts:pO,max:P.fichas,det:Math.round((d.fichasPct||0)*100)+"%"}]};
  }
  /* NIVEL. OJO con el total: el líder no tiene cargados todos los ítems que ve la comercial —le
     faltan la constancia del día y, desde octubre, el mínimo de venta semanal. Antes esos puntos
     contaban como CERO y el nivel salía sobre 95 (sobre 85 con los pesos nuevos), así que el
     tablero mostraba a todas más abajo de lo que están. Ahora el puntaje se lleva a base 100 sobre
     lo que realmente se midió: si el dato llega, entra; si no llega, no castiga. */
  function nivel(d){
    if(d.perfil==="externo") return {nombre:"Externo",emoji:"🔵",mult:1,pts:0,params:[],perfil:"Externo"};
    const NP=(d.cfg&&d.cfg.nivelPesos)||null;
    const sp=(NP&&NP[d.perfil])||PERFIL[d.perfil]||PERFIL.farm; const P=[];
    const rV=d.objetivoCobro>0?Math.min(d.cobradoMes/d.objetivoCobro,1):0; P.push({ic:"💰",lab:"Cobro vs objetivo de cobranza",max:sp.valor,pts:sp.valor*rV,det:Math.round(rV*100)+"% de "+Math.round((d.objetivoCobro||0)/1e6)+"M (distinto de la meta de facturación)"});
    const rA=cl(d.actividadRatio||0,0,1); P.push({ic:"📞",lab:"Actividad",max:sp.activ,pts:sp.activ*rA,det:Math.round(rA*100)+"% de tu promedio mensual"});
    const rEnv=Math.min((d.ofEnviadas||0)/30,1); P.push({ic:"📤",lab:"Ofertas enviadas",max:8,pts:8*rEnv,det:(d.ofEnviadas||0)+"/30 este mes"});
    const rVen=Math.min((d.ofVendidas||0)/10,1); P.push({ic:"🎁",lab:"Ofertas vendidas",max:17,pts:17*rVen,det:(d.ofVendidas||0)+"/10 colocadas"});
    const _nMeta=((d.cfg&&d.cfg.nuevosMeta)||{})[d.perfil]||3;
    const _nHechos=(d.nuevosCompraron!=null)?d.nuevosCompraron:(d.nuevos||0);
    const rN=Math.min(_nHechos/_nMeta,1); P.push({ic:"🆕",lab:"Nuevos",max:20,pts:20*rN,det:_nHechos+" de "+_nMeta});
    if(d.contactosUltDia!=null){
      const _cM=(d.cfg&&d.cfg.contactosDia)||15, rC=Math.min(d.contactosUltDia/_cM,1);
      P.push({ic:"🔥",lab:"Constancia ("+_cM+"/día)",max:5,pts:5*rC,det:d.contactosUltDia+" contactos"});
    }
    if(d.semanasMin && d.semanasMin.habilesTot>0){
      const _mx=(NP&&NP.semanal)||10, r=d.semanasMin.habilesOk/d.semanasMin.habilesTot;
      P.push({ic:"📅",lab:"Mínimo de venta semanal",max:_mx,pts:_mx*r,det:d.semanasMin.ok+" de "+d.semanasMin.total+" semanas"});
    }
    // a base 100 sobre lo medido: un ítem que no llegó no puede contar como cero
    const bruto=P.reduce((s,p)=>s+p.pts,0), tope=P.reduce((s,p)=>s+p.max,0)||100;
    const pts=bruto/tope*100, parcial=tope<100;
    const idx=pts<40?0:pts<60?1:pts<80?2:pts<95?3:4;
    return {nombre:NIV[idx].n,emoji:NIV[idx].e,mult:NIV[idx].m,pts,params:P,perfil:sp.nom,parcial,medido:tope};
  }
  function comision(d){
    // tasas: de la config (d.rates) si viene; si no, defaults. corte: d.meta (nueva) si viene, si no baseline×1,2 (viejo).
    const R=d.rates||RATES;
    const rt=d.perfil==="externo"?(R.externo||{base:.03,high:.04}):(R[d.perfil]||R.farm||RATES.farm);
    const pen=d.perfil==="externo"?0:salud(d).penaltyPt/100;
    const rB=Math.max(0,rt.base-pen), rH=Math.max(0,rt.high-pen);
    const corte=d.perfil==="externo"?(d.externoCorte||50e6):(d.meta!=null?d.meta:(d.factBaseline||0)*1.2);
    const t1=Math.min(d.factMes,corte), t2=Math.max(d.factMes-corte,0);
    const base=t1*rB+t2*rH;
    const mult=d.perfil==="externo"?1:nivel(d).mult;
    /* EL FRENO DEL 3%: el nivel multiplica sólo el tramo base. Lo que pasa la meta ya se paga al
       3%, el máximo de la casa. Mismo cálculo que el motor y que el panel de la comercial. */
    const freno=!!(d.cfg&&d.cfg.nivelSoloTramoBase!==false&&window.EYG&&EYG.paqueteRige&&d.mes&&EYG.paqueteRige(d.mes,d.cfg));
    const total=(d.perfil==="externo")?base:(freno?(t1*rB*mult+t2*rH):base*mult);
    return {base, mult, total, corte, rt, freno, penaltyPt: d.perfil==="externo"?0:salud(d).penaltyPt};
  }
  return { perfilDe, salud, nivel, comision, RATES, PERFIL, NIV, EXTERNOS };
})();
